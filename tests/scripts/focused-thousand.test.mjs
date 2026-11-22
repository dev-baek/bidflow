import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedConfig, planFocused, localLoadUrl, judgeFocused, judgeResources } from '../../scripts/focused-thousand.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const auctionId = uuid(1), runId = 'test-run', mode = 'smoke', endsAt = '2030-01-01T13:00:00Z';
  const receipts = Array.from({length:10}, (_,i) => ({...planFocused(runId,mode,i%2+1,Math.floor(i/2)),
    requestId:uuid(i+10),httpStatus:202,receiptStatus:'RECEIVED',durationMs:10}));
  const rows = receipts.map((r,i) => ({requestId:r.requestId,key:r.key,auctionId,bidderId:r.actor,amount:r.amount,
    decision:'ACCEPTED',ledgers:[{id:uuid(i+100),bidderId:r.actor,amount:r.amount,decision:'ACCEPTED',price:r.amount,reason:null}],
    events:[{id:uuid(i+200),requestId:r.requestId,auctionId,bidderId:r.actor,type:'BidAccepted',price:r.amount,reason:null,version:i+2}]}));
  return {runId,mode,auctionId,endsAt,receipts,snapshot:{requestCount:10,ledgerCount:10,resultCount:10,rows,
    auction:{auctionId,status:'ACTIVE',currentPrice:510000,winnerId:receipts[9].actor,version:11,endsAt}}};
}

test('focused plan has exactly 1000 unique requests, actors and prices without mutating inputs', () => {
  const {vus,iterations}=focusedConfig('full');
  const plans=Array.from({length:vus},(_,v)=>Array.from({length:iterations},(_,i)=>planFocused('run-123','full',v+1,i))).flat();
  for(const field of ['index','key','actor','amount'])assert.equal(new Set(plans.map(p=>p[field])).size,1000);
  assert.equal(Math.min(...plans.map(p=>p.amount)),60000);
  assert.equal(Math.max(...plans.map(p=>p.amount)),50010000);
  assert.deepEqual(focusedConfig('smoke'),{vus:2,iterations:5,count:10});
});

test('unsafe run IDs, invalid modes/indices and nonlocal URLs fail before I/O', () => {
  for(const id of ['', '../secret', 'a\nb', 'a'.repeat(41)])assert.throws(()=>planFocused(id,'full',1,0));
  for(const [mode,v,i] of [['other',1,0],['full',0,0],['full',21,0],['full',1,50],['full',1,0.5]])assert.throws(()=>planFocused('run',mode,v,i));
  for(const url of ['https://example.com','http://127.0.0.1:8080@evil.test','http://localhost:8080/path','http://host.docker.internal:9090'])assert.throws(()=>localLoadUrl(url));
  assert.equal(localLoadUrl('http://host.docker.internal:8080/'),'http://host.docker.internal:8080');
});

test('SQL agreement validates every request, increasing version chain and final winner purely', () => {
  const f=fixture(), before=structuredClone(f);
  assert.deepEqual(judgeFocused(f),{valid:true,total:10,accepted:10,rejected:0});
  assert.deepEqual(f,before);
  f.receipts.reverse();f.snapshot.rows.reverse();
  assert.equal(judgeFocused(f).valid,true);
});

test('normal rejection keeps submitted amount but null settlement price and a valid version', () => {
  const f=fixture(),row=f.snapshot.rows[0];
  row.decision='REJECTED';Object.assign(row.ledgers[0],{decision:'REJECTED',price:null,reason:'BID_TOO_LOW'});
  Object.assign(row.events[0],{type:'BidRejected',price:null,reason:'BID_TOO_LOW',version:2});
  for(const r of f.snapshot.rows.slice(1))r.events[0].version--;
  f.snapshot.auction.version--;
  assert.deepEqual(judgeFocused(f),{valid:true,total:10,accepted:9,rejected:1});
  row.events[0].version=999;
  assert.equal(judgeFocused(f).valid,false);
});

test('missing/duplicate/foreign receipts, invalid HTTP body and altered plan never pass by counts', () => {
  const changes=[f=>f.receipts.pop(),f=>f.receipts[1].requestId=f.receipts[0].requestId,
    f=>f.receipts[0].httpStatus=500,f=>f.receipts[0].receiptStatus='ACCEPTED',f=>f.receipts[0].requestId='bad',
    f=>f.receipts[0].key='foreign',f=>f.receipts[0].amount++,f=>f.snapshot.rows[0].requestId=uuid(999),
    f=>f.snapshot.rows[1]=structuredClone(f.snapshot.rows[0])];
  for(const change of changes){const f=fixture();change(f);assert.equal(judgeFocused(f).valid,false);}
});

test('ledger/event identity, status, price/version, count and final auction corruption fail closed', () => {
  const changes=[f=>f.snapshot.rows[0].ledgers=[],f=>f.snapshot.rows[0].events.push(f.snapshot.rows[0].events[0]),
    f=>f.snapshot.rows[0].decision='RECEIVED',f=>f.snapshot.rows[0].ledgers[0].amount++,
    f=>f.snapshot.rows[0].events[0].price++,f=>f.snapshot.rows[0].events[0].bidderId='other',
    f=>f.snapshot.rows[0].events[0].requestId=uuid(900),f=>f.snapshot.rows[0].events[0].auctionId=uuid(900),
    f=>f.snapshot.rows[0].events[0].version=3,f=>f.snapshot.rows[1].ledgers[0].id=f.snapshot.rows[0].ledgers[0].id,
    f=>f.snapshot.ledgerCount++,f=>f.snapshot.auction.winnerId='other',f=>f.snapshot.auction.currentPrice++,
    f=>f.snapshot.auction.version++,f=>f.snapshot.auction.endsAt='2030-01-02T00:00:00Z'];
  for(const change of changes){const f=fixture();change(f);assert.equal(judgeFocused(f).valid,false);}
});

test('resource validation distinguishes sustained CPU pressure, missing coverage, OOM and safe run', () => {
  const input={startedMs:0,endedMs:7000,samples:Array.from({length:8},(_,i)=>({atMs:i*1000,cpu:25,pressure:1})),
    containers:[{atMs:0,oom:false,memoryBytes:1000},{atMs:7000,oom:false,memoryBytes:2000}]};
  assert.equal(judgeResources(input).valid,true);
  for(const change of [f=>f.samples.splice(2,5),f=>f.samples.forEach(s=>s.cpu=95),
    f=>f.samples[2].pressure=4,f=>f.containers[0].oom=true,f=>f.samples[3].cpu=NaN,
    f=>f.containers=[],f=>f.samples.reverse(),f=>f.samples[1]=null,f=>f.containers[0]=null]){
    const f=structuredClone(input);change(f);assert.equal(judgeResources(f).valid,false);
  }
});

test('malformed top-level inputs remain explicit failed verdicts',()=>{
  for(const value of [undefined,null,{},[],{receipts:[]}])assert.equal(judgeFocused(value).valid,false);
  for(const value of [undefined,null,{},[]])assert.equal(judgeResources(value).valid,false);
});
