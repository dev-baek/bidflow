import test from 'node:test';
import assert from 'node:assert/strict';
import {createFailureJournal,judgeFailureCorrelation,captureFailure,validateFailureProbe} from '../../scripts/failure-correlation.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const auctionId=uuid(1),endsAt='2030-01-01T12:30:00Z',source='a'.repeat(40);
function fixture(){
  let clock=0;const journal=createFailureJournal({runId:uuid(2),source,now:()=>clock++});journal.register(auctionId,endsAt);
  const rows=[12000,13000,14000].map((amount,i)=>{
    const role=i===1?'B':'A',bidderId=role==='A'?'e2e-direct-a':'e2e-direct-b',id=uuid(10+i),key=uuid(20+i),eventId=uuid(30+i);
    for(let n=0;n<(i===0?101:1);n++)journal.http({role,auctionId,key,amount,status:202,body:{bidRequestId:id,status:'RECEIVED',token:'SECRET'}});
    const payload={eventId,auctionId,auctionVersion:i+2,currentPrice:amount,endsAt,token:'SECRET'};
    journal.frame(role,JSON.stringify({...payload,type:'bid.result',bidRequestId:id,decision:'ACCEPTED',reason:null,isHighestBidder:true}));
    for(const viewer of ['A','B'])journal.frame(viewer,JSON.stringify({...payload,type:'auction.updated'}));
    return {requestId:id,key,auctionId,bidderId,amount,decision:'ACCEPTED',
      ledgers:[{id:uuid(40+i),bidderId,amount,decision:'ACCEPTED',price:amount,reason:null}],
      events:[{id:eventId,type:'BidAccepted',requestId:id,auctionId,bidderId,version:i+2,price:amount,reason:null}]};
  });
  journal.http({role:'A',auctionId,key:uuid(20),amount:99000,status:409,body:{code:'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',secret:'SECRET'}});
  const sql={rows,requestCount:3,ledgerCount:3,resultCount:3,auction:{auctionId,status:'ACTIVE',currentPrice:14000,winnerId:'e2e-direct-a',version:4,endsAt}};
  return {journal,sql};
}
test('correlates three settlements, 100 replays and domain events without retaining unknown data',()=>{
  const {journal,sql}=fixture(),state=journal.close(),result=judgeFailureCorrelation(state,sql);
  assert.equal(result.complete,true);assert.equal(result.links.length,3);assert.equal(state.http.length,104);
  assert.ok(!JSON.stringify({state,result}).includes('SECRET'));assert.ok(!JSON.stringify(result).includes('e2e-direct'));
  assert.equal(judgeFailureCorrelation({...state,ws:[...state.ws,state.ws[0]]},sql).complete,true);
});
test('rejects corrupted identity, ownership, count, version, price, time and incomplete input',()=>{
  const {journal,sql}=fixture(),state=journal.close();
  for(const mutate of [s=>s.rows[0].events[0].id=uuid(90),s=>s.rows[0].ledgers[0].bidderId='foreign',s=>s.ledgerCount=4,s=>s.rows[1].events[0].version=9,s=>s.rows[0].events[0].price=1,s=>s.auction.endsAt='invalid',s=>s.rows.pop()]){
    const bad=structuredClone(sql);mutate(bad);assert.equal(judgeFailureCorrelation(state,bad).complete,false);
  }
  for(const mutate of [s=>s.http.pop(),s=>s.ws=[],s=>s.ws[0].eventId=uuid(99),s=>s.ws[0].role='B',s=>s.ws[0].version=8,s=>s.ws[0].price=14000,s=>s.truncated=true,s=>s.ws[0].atMs=-1,s=>s.ws[0].endsAt='invalid']){
    const bad=structuredClone(state);mutate(bad);assert.equal(judgeFailureCorrelation(bad,sql).complete,false);
  }
});
test('allows a proven newer snapshot but not an unrelated version/price pair',()=>{
  const {journal,sql}=fixture(),state=journal.close();state.ws[0].version=4;state.ws[0].price=14000;
  assert.equal(judgeFailureCorrelation(state,sql).complete,true);state.ws[0].price=13000;
  assert.equal(judgeFailureCorrelation(state,sql).complete,false);
});
test('bounds input, rejects unknown scope and non-finite values, and closes against late callbacks',()=>{
  for(const change of [{auctionId:uuid(98)},{role:'FOREIGN'},{amount:Infinity},{key:'token'}]){
    const {journal,sql}=fixture();journal.http({role:'A',auctionId,key:uuid(20),amount:12000,status:202,body:{bidRequestId:uuid(10),status:'RECEIVED'},...change});assert.equal(judgeFailureCorrelation(journal.close(),sql).complete,false);
  }
  const {journal,sql}=fixture();for(let i=0;i<300;i++)journal.console('A','log','SECRET');
  const state=journal.close();assert.equal(state.console.length,64);assert.equal(state.truncated,true);assert.equal(judgeFailureCorrelation(state,sql).complete,false);
  journal.http({token:'LATE_SECRET'});assert.equal(JSON.stringify(state).includes('SECRET'),false);
});
test('capture separates correlation from attachments and preserves original failure through I/O errors',async()=>{
  const {journal,sql}=fixture();let saved,attached=false;
  const io={sql:async()=>sql,screenshot:async()=>({bytes:1,sha256:'a'.repeat(64)}),detach:()=>{},write:data=>{saved=data;return '/external/evidence.json';},attach:async()=>{attached=true;}};
  const result=await captureFailure(journal,io);assert.equal(result.diagnosticsComplete,true);assert.equal(attached,true);assert.equal(saved.correlation.complete,true);
  for(const key of ['sql','screenshot','detach','write','attach']){
    const f=fixture();const bad={...io,[key]:()=>{throw Error('SECRET');}};const e=await captureFailure(f.journal,bad);assert.equal(e.diagnosticsComplete,false,key);assert.ok(!JSON.stringify(e).includes('SECRET'));
  }
  const empty=createFailureJournal({runId:uuid(2),source,now:()=>0});let queried=false;
  const e=await captureFailure(empty,{...io,sql:()=>{queried=true;}});assert.equal(queried,false);assert.equal(e.diagnosticsComplete,false);
});
test('timeouts do not mutate saved evidence or start late attachments',async()=>{
  const {journal}=fixture();let resolve,attached=false,saved;
  const result=await captureFailure(journal,{sql:()=>new Promise(r=>{resolve=r;}),screenshot:async()=>({bytes:1,sha256:'b'.repeat(64)}),detach:()=>{},write:e=>{saved=e;return '/external/evidence.json';},attach:async()=>{attached=true;}},{budgetMs:5});
  const before=JSON.stringify(saved);resolve(fixture().sql);await new Promise(r=>setTimeout(r,10));
  assert.equal(result.diagnosticsComplete,false);assert.equal(JSON.stringify(saved),before);assert.equal(attached,false);
});
test('probe is opt-in and restricted to one local case with no parallelism or retry',()=>{
  const input={flag:'direct-bid',web:'http://127.0.0.1:5173',api:'http://127.0.0.1:8080',title:'직접 입찰 재시도는 같은 요청이고 같은 사용자의 후속 입찰은 새 요청이다',workers:1,retries:0};
  assert.equal(validateFailureProbe(input),true);assert.equal(validateFailureProbe({...input,flag:undefined}),false);
  for(const change of [{flag:'other'},{api:'https://example.com'},{web:'http://localhost.evil:5173'},{title:'other'},{workers:2},{retries:1}])assert.throws(()=>validateFailureProbe({...input,...change}));
});
test('records only a fixed failure stage',()=>{
  const {journal}=fixture();journal.verified();assert.equal(journal.close().stage,'VERIFIED');
});
test('rejects budgets beyond the approved ceiling',async()=>{
  await assert.rejects(captureFailure(fixture().journal,{}, {budgetMs:10001}),/INVALID_CAPTURE_BUDGET/);
});
test('message-id cannot substitute for a domain event id, and HTTP/WS limits fail closed',()=>{
  const f=fixture();f.journal.frame('A',JSON.stringify({type:'bid.result',messageId:uuid(30),auctionId,auctionVersion:2,currentPrice:12000,endsAt}));
  assert.equal(judgeFailureCorrelation(f.journal.close(),f.sql).complete,false);
  const {journal,sql}=fixture();for(let i=0;i<300;i++)journal.http({role:'A',auctionId,key:uuid(20),amount:12000,status:202,body:{bidRequestId:uuid(10),status:'RECEIVED'}});
  const s=journal.close();assert.equal(s.http.length,256);assert.equal(s.truncated,true);assert.equal(judgeFailureCorrelation(s,sql).complete,false);
});
test('retains an unexpected HTTP status without retaining its arbitrary response body',()=>{
  const {journal,sql}=fixture();journal.http({role:'A',auctionId,key:uuid(20),amount:12000,status:503,body:{error:'SECRET'}});
  const state=journal.close();assert.equal(state.http.at(-1).status,503);assert.ok(!JSON.stringify(state).includes('SECRET'));assert.equal(judgeFailureCorrelation(state,sql).complete,false);
});
test('preserves a known rejection in partial SQL without claiming the expected chain passed',()=>{
  const {journal,sql}=fixture(),row=sql.rows[0];row.decision='REJECTED';Object.assign(row.ledgers[0],{decision:'REJECTED',price:null,reason:'AUCTION_ENDED'});Object.assign(row.events[0],{type:'BidRejected',price:null,reason:'AUCTION_ENDED'});
  const result=judgeFailureCorrelation(journal.close(),sql);assert.equal(result.complete,false);assert.equal(result.sql?.rows[0].reason,'AUCTION_ENDED');
});
