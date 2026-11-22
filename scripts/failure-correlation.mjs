import {isUuid} from './final-settlement.mjs';
const roles=['A','B'],actors={A:'e2e-direct-a',B:'e2e-direct-b'};
const rejectionReasons=['BID_TOO_LOW','SELF_BID','AUCTION_ENDED','AUCTION_NOT_STARTED','NOT_ACTIVE'];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const instant=s=>typeof s==='string'&&s.length<=40&&Number.isFinite(Date.parse(s));
const alias=id=>Object.keys(actors).find(k=>actors[k]===id)??null;
const clone=value=>structuredClone(value);
const title='직접 입찰 재시도는 같은 요청이고 같은 사용자의 후속 입찰은 새 요청이다';
export function validateFailureProbe({flag,web,api,title:caseTitle,workers,retries}){
  if(flag===undefined)return false;
  const local=value=>{try{const u=new URL(value);return u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}};
  if(flag!=='direct-bid'||!local(web)||!local(api)||caseTitle!==title||workers!==1||retries!==0)throw Error('INVALID_FAILURE_PROBE');
  return true;
}
export function createFailureJournal({runId,source,now}){
  if(!isUuid(runId)||!/^[a-f0-9]{40}$/.test(source))throw Error('INVALID_DIAGNOSTIC_SCOPE');
  const state={runId,source,caseId:'direct-bid',stage:'SETUP',auctionId:null,initialEndsAt:null,http:[],ws:[],console:[],invalid:0,truncated:false};
  let closed=false,last=-1;
  const at=()=>{const n=now();if(!Number.isFinite(n)||n<0||n<last)throw Error('CLOCK_INVALID');last=n;return n;};
  const add=(kind,limit,project)=>{if(closed)return;try{const value=project();if(state[kind].length>=limit){state.truncated=true;return;}state[kind].push({...value,atMs:at()});}catch{state.invalid++;}};
  return {
    register:(id,endsAt)=>{if(closed)return;if(!isUuid(id)||!instant(endsAt)||(state.auctionId&&state.auctionId!==id)){state.invalid++;return;}state.auctionId=id;state.initialEndsAt=endsAt;state.stage='REGISTERED';},
    verified:()=>{if(!closed)state.stage='VERIFIED';},
    http:r=>add('http',256,()=>{
      state.stage='BIDDING';
      if(!roles.includes(r.role)||r.auctionId!==state.auctionId||!isUuid(r.key)||!integer(r.amount)||!Number.isInteger(r.status)||r.status<100||r.status>599)throw Error();
      if(r.status===202&&isUuid(r.body?.bidRequestId)&&r.body.status==='RECEIVED')return {role:r.role,auctionId:r.auctionId,key:r.key,amount:r.amount,status:202,requestId:r.body.bidRequestId,receiptStatus:'RECEIVED',code:null};
      if(r.status===409&&r.body?.code==='IDEMPOTENCY_KEY_PAYLOAD_MISMATCH')return {role:r.role,auctionId:r.auctionId,key:r.key,amount:r.amount,status:409,requestId:null,receiptStatus:null,code:r.body.code};
      return {role:r.role,auctionId:r.auctionId,key:r.key,amount:r.amount,status:r.status,requestId:null,receiptStatus:null,code:'UNEXPECTED_HTTP_RESPONSE'};
    }),
    frame:(role,raw)=>add('ws',64,()=>{
      if(typeof raw!=='string'||raw.length>8192)throw Error();const r=JSON.parse(raw);
      if(!roles.includes(role)||r.auctionId!==state.auctionId||!isUuid(r.eventId)||!integer(r.auctionVersion)||r.auctionVersion<1||!integer(r.currentPrice)||!instant(r.endsAt))throw Error();
      const base={role,auctionId:r.auctionId,eventId:r.eventId,version:r.auctionVersion,price:r.currentPrice,endsAt:r.endsAt};
      if(r.type==='auction.updated'||r.type==='auction.ended')return {...base,channel:'public',type:r.type};
      if(r.type!=='bid.result'||!isUuid(r.bidRequestId)||!['ACCEPTED','REJECTED'].includes(r.decision)||!(r.reason===null||rejectionReasons.includes(r.reason))||typeof r.isHighestBidder!=='boolean')throw Error();
      return {...base,channel:'private',type:r.type,requestId:r.bidRequestId,decision:r.decision,reason:r.reason,isHighestBidder:r.isHighestBidder};
    }),
    console:(role,level,marker)=>add('console',64,()=>{if(!roles.includes(role)||!['log','info','warning','error','debug'].includes(level))throw Error();return {role,level,marker:marker==='BIDFLOW_E2E_CORRELATION'?marker:null};}),
    invalidate:()=>{if(!closed)state.invalid++;},
    close:()=>{closed=true;return clone(state);},
  };
}
function projectSql(s,id){
  if(!s||!['requestCount','ledgerCount','resultCount'].every(k=>integer(s[k])&&s[k]<=128)||!Array.isArray(s.rows)||s.rows.length>128)throw Error();
  const a=s.auction;
  if(a?.auctionId!==id||!['ACTIVE','SCHEDULED','ENDED'].includes(a.status)||!integer(a.currentPrice)||!integer(a.version)||a.version<1||!instant(a.endsAt)||(a.winnerId!==null&&!alias(a.winnerId)))throw Error();
  const rows=s.rows.map(r=>{
    if(r.auctionId!==id||!isUuid(r.requestId)||!isUuid(r.key)||!alias(r.bidderId)||!integer(r.amount)||!['ACCEPTED','REJECTED'].includes(r.decision)||r.ledgers?.length!==1||r.events?.length!==1)throw Error();
    const l=r.ledgers[0],e=r.events[0];
    if(!isUuid(l.id)||!isUuid(e.id)||l.bidderId!==r.bidderId||e.bidderId!==r.bidderId||l.amount!==r.amount||l.decision!==r.decision||e.auctionId!==id||e.requestId!==r.requestId||!integer(e.version)||e.version<1)throw Error();
    const accepted=r.decision==='ACCEPTED',reason=accepted?null:l.reason;
    if(!accepted&&!rejectionReasons.includes(reason))throw Error();
    if(e.type!==(accepted?'BidAccepted':'BidRejected')||l.reason!==reason||e.reason!==reason||l.price!==(accepted?r.amount:null)||e.price!==l.price)throw Error();
    return {requestId:r.requestId,key:r.key,role:alias(r.bidderId),amount:r.amount,decision:r.decision,ledgerId:l.id,eventId:e.id,settlementVersion:e.version,price:l.price,reason:l.reason};
  });
  return {requestCount:s.requestCount,ledgerCount:s.ledgerCount,resultCount:s.resultCount,rows,auction:{auctionId:id,status:a.status,price:a.currentPrice,winner:alias(a.winnerId),version:a.version,endsAt:a.endsAt}};
}
export function judgeFailureCorrelation(state,rawSql){
  let sql=null;
  const fail=code=>({complete:false,code,sql,links:[]});
  try{
    if(!isUuid(state?.auctionId))return fail('NOT_REGISTERED');
    sql=projectSql(rawSql,state.auctionId);
    if(state.invalid!==0||state.truncated||state.http.length!==104||!Array.isArray(state.ws)||state.ws.length>64)return fail('INPUT_INCOMPLETE');
    if(state.http.some(r=>!Number.isFinite(r.atMs)||r.atMs<0)||state.ws.some(r=>!Number.isFinite(r.atMs)||r.atMs<0||!instant(r.endsAt)))return fail('INVALID_OBSERVATION');
    if(![sql.requestCount,sql.ledgerCount,sql.resultCount,sql.rows.length].every(n=>n===3))return fail('SQL_COUNTS');
    const rows=[...sql.rows].sort((a,b)=>a.amount-b.amount);
    if(rows.some((r,i)=>r.amount!==12000+i*1000||r.role!==(i===1?'B':'A')||r.decision!=='ACCEPTED'||r.settlementVersion!==i+2)
      ||['requestId','key','ledgerId','eventId'].some(k=>new Set(rows.map(r=>r[k])).size!==3))return fail('SETTLEMENT_CHAIN');
    if(sql.auction.status!=='ACTIVE'||sql.auction.price!==14000||sql.auction.winner!=='A'||sql.auction.version!==4||Date.parse(sql.auction.endsAt)!==Date.parse(state.initialEndsAt))return fail('FINAL_AUCTION');
    const ok=state.http.filter(r=>r.status===202),conflicts=state.http.filter(r=>r.status===409);
    if(ok.length!==103||conflicts.length!==1||conflicts[0].key!==rows[0].key||conflicts[0].amount!==99000||conflicts[0].role!=='A'||conflicts[0].code!=='IDEMPOTENCY_KEY_PAYLOAD_MISMATCH')return fail('HTTP_COUNTS');
    for(const [i,row]of rows.entries()){
      const receipts=ok.filter(r=>r.requestId===row.requestId);
      if(receipts.length!==(i===0?101:1)||receipts.some(r=>r.key!==row.key||r.amount!==row.amount||r.role!==row.role||r.auctionId!==state.auctionId||r.receiptStatus!=='RECEIVED'))return fail('HTTP_IDENTITY');
    }
    const seen=new Map();
    for(const frame of state.ws){
      const row=rows.find(r=>r.eventId===frame.eventId);
      if(!row||frame.auctionId!==state.auctionId||!roles.includes(frame.role)||Date.parse(frame.endsAt)!==Date.parse(state.initialEndsAt)
        ||frame.version<row.settlementVersion||!rows.some(r=>r.settlementVersion===frame.version&&r.price===frame.price))return fail('WS_SNAPSHOT');
      if(frame.channel==='private'){
        if(frame.type!=='bid.result'||frame.role!==row.role||frame.requestId!==row.requestId||frame.decision!==row.decision||frame.reason!==null||frame.isHighestBidder!==true)return fail('PRIVATE_IDENTITY');
      }else if(frame.channel!=='public'||frame.type!=='auction.updated')return fail('WS_CHANNEL');
      const key=[frame.role,frame.channel,frame.eventId].join(':'),value=JSON.stringify({...frame,atMs:0});
      if(seen.has(key)&&seen.get(key)!==value)return fail('CONFLICTING_FRAME');seen.set(key,value);
    }
    for(const row of rows)if(!seen.has(`${row.role}:private:${row.eventId}`)||roles.some(role=>!seen.has(`${role}:public:${row.eventId}`)))return fail('MISSING_FRAME');
    return {complete:true,code:'CORRELATED',sql,links:rows.map(r=>({...r}))};
  }catch{return fail('SQL_OR_INPUT_INVALID');}
}
export async function captureFailure(journal,io,{budgetMs=10000}={}){
  if(!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>10000)throw Error('INVALID_CAPTURE_BUDGET');
  const state=journal.close(),deadline=Date.now()+budgetMs;
  const attempt=async(fn,max=10000)=>{
    const ms=Math.min(max,deadline-Date.now());if(ms<=0)return {status:'TIMEOUT'};
    let timer;
    try{return await Promise.race([Promise.resolve().then(fn).then(value=>({status:'OK',value}),()=>({status:'FAILED'})),new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'TIMEOUT'}),ms);})]);}finally{clearTimeout(timer);}
  };
  let cleanup='OK';try{io.detach();}catch{cleanup='FAILED';}
  const [sql,a,b]=await Promise.all([state.auctionId?attempt(()=>io.sql(state.auctionId),5000):Promise.resolve({status:'NOT_REGISTERED'}),...roles.map(role=>attempt(()=>io.screenshot(role),3000))]);
  const screen=r=>r.status==='OK'&&integer(r.value?.bytes)&&r.value.bytes>0&&/^[a-f0-9]{64}$/.test(r.value?.sha256)?{status:'OK',bytes:r.value.bytes,sha256:r.value.sha256}:{status:r.status==='OK'?'FAILED':r.status};
  const data={...state,correlation:judgeFailureCorrelation(state,sql.value),capture:{sql:sql.status,A:screen(a),B:screen(b),cleanup,attachmentVerification:'REPORTER_REQUIRED'}};
  let written=false,attached=false;
  try{const path=io.write(clone(data));written=true;if(Date.now()<deadline)attached=(await attempt(()=>io.attach(path))).status==='OK';}catch{}
  const diagnosticsComplete=data.correlation.complete&&sql.status==='OK'&&data.capture.A.status==='OK'&&data.capture.B.status==='OK'&&cleanup==='OK'&&written&&attached;
  return {data,diagnosticsComplete,written,attached};
}
