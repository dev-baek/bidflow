import { isUuid } from './final-settlement.mjs';

export function focusedConfig(mode) {
  if (!['full','smoke'].includes(mode)) throw Error('invalid focused mode');
  const vus=mode==='full'?20:2, iterations=mode==='full'?50:5;
  return {vus,iterations,count:vus*iterations};
}

export function planFocused(runId,mode,vu,iteration) {
  const {vus,iterations}=focusedConfig(mode);
  if(typeof runId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,39}$/.test(runId)
    ||!Number.isInteger(vu)||vu<1||vu>vus||!Number.isInteger(iteration)||iteration<0||iteration>=iterations) throw Error('invalid focused plan');
  const index=vus*iteration+vu-1, key=`load-${runId}-focused-thousand-${vu}-${iteration}`;
  return {vu,iteration,index,key,actor:`${runId}-bidder-${index}`,amount:10000+50000*(index+1)};
}

export function localLoadUrl(value) {
  const url=typeof value==='string'?value.replace(/\/$/,''):'';
  if(!['http://127.0.0.1:8080','http://localhost:8080','http://[::1]:8080','http://host.docker.internal:8080'].includes(url)) throw Error('local load URL required');
  return url;
}

export function judgeFocused(input) {
  const {runId,mode,auctionId,endsAt,receipts,snapshot}=input??{};
  const fail=()=>({valid:false});
  try {
    const {count}=focusedConfig(mode);
    if(!isUuid(auctionId)||!Number.isFinite(Date.parse(endsAt))||!Array.isArray(receipts)||receipts.length!==count
      ||!snapshot||snapshot.requestCount!==count||snapshot.ledgerCount!==count||snapshot.resultCount!==count
      ||!Array.isArray(snapshot.rows)||snapshot.rows.length!==count) return fail();
    const ids=new Set(),indices=new Set(),ledgerIds=new Set(),eventIds=new Set(),accepted=[],rejected=[];
    const rows=new Map(snapshot.rows.map(r=>[r?.requestId,r]));
    if(rows.size!==count)return fail();
    for(const receipt of receipts) {
      const plan=planFocused(runId,mode,receipt.vu,receipt.iteration);
      if(Object.keys(plan).some(k=>receipt[k]!==plan[k])||!isUuid(receipt.requestId)||ids.has(receipt.requestId)
        ||indices.has(plan.index)||receipt.httpStatus!==202||receipt.receiptStatus!=='RECEIVED'
        ||!Number.isFinite(receipt.durationMs)||receipt.durationMs<0)return fail();
      ids.add(receipt.requestId);indices.add(plan.index);
      const row=rows.get(receipt.requestId);
      if(!row||row.key!==plan.key||row.auctionId!==auctionId||row.bidderId!==plan.actor||row.amount!==plan.amount
        ||!['ACCEPTED','REJECTED'].includes(row.decision)||row.ledgers?.length!==1||row.events?.length!==1)return fail();
      const l=row.ledgers[0],e=row.events[0],isAccepted=row.decision==='ACCEPTED';
      const price=isAccepted?plan.amount:null,reason=isAccepted?null:'BID_TOO_LOW';
      if(!l||!e||!isUuid(l.id)||!isUuid(e.id)||ledgerIds.has(l.id)||eventIds.has(e.id)
        ||l.bidderId!==plan.actor||l.amount!==plan.amount||l.decision!==row.decision||l.price!==price||l.reason!==reason
        ||e.requestId!==receipt.requestId||e.auctionId!==auctionId||e.bidderId!==plan.actor
        ||e.type!==(isAccepted?'BidAccepted':'BidRejected')||e.price!==price||e.reason!==reason
        ||!Number.isSafeInteger(e.version))return fail();
      ledgerIds.add(l.id);eventIds.add(e.id);
      (isAccepted?accepted:rejected).push({version:e.version,price:plan.amount,actor:plan.actor});
    }
    accepted.sort((a,b)=>a.version-b.version);
    if(accepted.length<2||accepted.some((e,i)=>e.version!==i+2||(i>0&&e.price<=accepted[i-1].price)))return fail();
    if(rejected.some(e=>!accepted.some(a=>a.version===e.version&&a.price>e.price)))return fail();
    const last=accepted.at(-1),a=snapshot.auction;
    if(!a||a.auctionId!==auctionId||a.status!=='ACTIVE'||a.version!==accepted.length+1
      ||a.currentPrice!==10000+50000*count||a.currentPrice!==last.price||a.winnerId!==last.actor
      ||Date.parse(a.endsAt)!==Date.parse(endsAt))return fail();
    return {valid:true,total:count,accepted:accepted.length,rejected:rejected.length};
  }catch{return fail();}
}

export function judgeResources(input) {
  const {startedMs,endedMs,samples,containers}=input??{};
  const fail=()=>({valid:false});
  if(!Number.isFinite(startedMs)||!Number.isFinite(endedMs)||endedMs<=startedMs||!Array.isArray(samples)||samples.length<2
    ||!Array.isArray(containers)||containers.length<2||containers.some(s=>!s))return fail();
  let high=0;
  for(let i=0;i<samples.length;i++) {
    const s=samples[i];
    if(!s||!Number.isFinite(s.atMs)||!Number.isFinite(s.cpu)||s.cpu<0||s.cpu>100||![1,2].includes(s.pressure)
      ||(i>0&&(s.atMs<=samples[i-1].atMs||s.atMs-samples[i-1].atMs>2500)))return fail();
    high=s.cpu>=90?high+1:0;if(high>=5)return fail();
  }
  if(samples[0].atMs>startedMs+1500||samples.at(-1).atMs<endedMs-1500
    ||containers[0].atMs>startedMs+5000||containers.at(-1).atMs<endedMs-5000
    ||containers.some((s,i)=>!s||!Number.isFinite(s.atMs)||s.oom!==false||!Number.isFinite(s.memoryBytes)||s.memoryBytes<=0
      ||(i>0&&s.atMs<=containers[i-1].atMs)))return fail();
  return {valid:true};
}
