import {isUuid} from './final-settlement.mjs';

const roles=['A','B'];
const stamp=n=>Number.isFinite(n)&&n>=0;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const instant=s=>typeof s==='string'&&s.length<=40&&Number.isFinite(Date.parse(s));
const same=(a,b)=>a.version===b.version&&a.price===b.price&&a.type===b.type
  &&Date.parse(a.endsAt)===Date.parse(b.endsAt);

export function createPublicJournal(auctionId,now) {
  const frames=[], counts={A:0,B:0};
  let error=null,closed=false,last=-1;
  const fail=code=>{if(!closed)error??=code;};
  return {
    fail,
    error:()=>error,
    frame(role,value){
      if(closed||error)return;
      const {auctionId:id,eventId,type,auctionVersion:version,currentPrice:price,endsAt}=value??{};
      const atMs=now();
      if(!roles.includes(role)||id!==auctionId||!isUuid(id)||!isUuid(eventId)||type!=='auction.updated'
        ||!positive(version)||!positive(price)||!instant(endsAt)||!stamp(atMs)||atMs<last)return fail('INVALID_FRAME');
      if(++counts[role]>2048)return fail('FRAME_LIMIT');
      last=atMs;
      const entry={role,auctionId:id,eventId,type,version,price,endsAt,atMs};
      frames.push(entry);
      return entry;
    },
    snapshot:()=>({frames:structuredClone(frames),error}),
    close:()=>{closed=true;},
  };
}

export function judgeBrowserConvergence(input) {
  const fail=code=>({valid:false,code,samples:[]});
  const {auctionId,endsAt,final,loadStartedMs:start,loadEndedMs:end,frames,screens,error}=input;
  const deadline=end+60000;
  if(error||!isUuid(auctionId)||!instant(endsAt)||!isUuid(final?.id)||!positive(final.version)||!positive(final.price)
    ||!stamp(start)||!stamp(end)||end<start||!Array.isArray(frames)||frames.length>4096)return fail(error??'INCOMPLETE_INPUT');
  const seen=new Map(),counts={A:0,B:0};
  for(const f of frames){
    if(!roles.includes(f.role)||++counts[f.role]>2048||f.auctionId!==auctionId||!isUuid(f.eventId)
      ||f.type!=='auction.updated'||!positive(f.version)||!positive(f.price)||!instant(f.endsAt)||!stamp(f.atMs)
      ||f.atMs<start)return fail('INVALID_FRAME');
    const previous=seen.get(f.eventId);
    if(previous&&!same(previous,f))return fail('CONFLICTING_FRAME');
    seen.set(f.eventId,f);
  }
  const samples=[];
  for(const role of roles){
    const matched=frames.filter(f=>f.role===role&&f.eventId===final.id);
    const frameMs=Math.min(...matched.map(f=>f.atMs)),screenMs=screens?.[role];
    if(!matched.length||matched.some(f=>f.version!==final.version||f.price!==final.price||Date.parse(f.endsAt)!==Date.parse(endsAt))
      ||!stamp(screenMs)||screenMs<frameMs||screenMs>deadline)return fail('FINAL_NOT_OBSERVED');
    samples.push({role,finalFrameMs:frameMs,finalScreenMs:screenMs,frameFromStartMs:frameMs-start,
      screenFromStartMs:screenMs-start,remainingAfterLoadMs:Math.max(0,screenMs-end),
      convergedBeforeLoadEnd:screenMs<=end,frameToScreenMs:screenMs-frameMs});
  }
  return {valid:true,code:'CONVERGED',samples};
}
