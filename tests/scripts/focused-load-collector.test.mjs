import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {setTimeout as wait} from 'node:timers/promises';
import {mkdtemp,writeFile,readFile,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planFocused} from '../../scripts/focused-thousand.mjs';
import {collectFocused,claimOutput,parseReceipt} from '../../scripts/focused-load-collector.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fake() {
  const auctionId=id(1),runId='fake19',endsAt='2030-01-01T13:00:00Z';
  const receipts=Array.from({length:10},(_,i)=>({...planFocused(runId,'smoke',i%2+1,Math.floor(i/2)),
    requestId:id(i+10),httpStatus:202,receiptStatus:'RECEIVED',durationMs:10}));
  const rows=receipts.map((r,i)=>({requestId:r.requestId,key:r.key,auctionId,bidderId:r.actor,amount:r.amount,decision:'ACCEPTED',
    ledgers:[{id:id(i+100),bidderId:r.actor,amount:r.amount,decision:'ACCEPTED',price:r.amount,reason:null}],
    events:[{id:id(i+200),requestId:r.requestId,auctionId,bidderId:r.actor,type:'BidAccepted',price:r.amount,reason:null,version:i+2}]}));
  const snapshot={rows,requestCount:10,ledgerCount:10,resultCount:10,
    auction:{auctionId,status:'ACTIVE',currentPrice:510000,winnerId:receipts[9].actor,version:11,endsAt}};
  const lag=Array.from({length:3},(_,i)=>({partition:i,currentOffset:0,endOffset:0,lag:0}));
  let restored=0,stopped=0,saved=[];
  const io={now:()=>performance.now(),wait:()=>wait(1),save:async e=>saved.push(structuredClone(e)),
    prepare:async()=>({clock:'system',delayMs:100}),restore:async()=>{restored++;return {verified:true};},
    fixture:async()=>({auctionId,runId,endsAt}),lag:async()=>lag,dlt:async()=>[0,0,0],
    cpu:async()=>({cpu:20,pressure:1}),containers:async()=>({oom:false,memoryBytes:1000}),
    start:async()=>({done:wait(25).then(()=>0),stop:async()=>{stopped++;}}),
    receipts:async()=>({records:receipts,invalid:0}),snapshot:async()=>snapshot,
    summary:async()=>({count:10,iterations:10,received:10,p50:10,p95:20,p99:25,errorRate:0})};
  return {io,receipts,snapshot,lag,get restored(){return restored;},get stopped(){return stopped;},get saved(){return saved;}};
}

test('collector joins a complete smoke without pretending it is a thousand-request result and always restores',async()=>{
  const f=fake(),e=await collectFocused('smoke',f.io);
  assert.equal(e.valid,true);assert.equal(e.fullVerified,false);assert.equal(e.consistency.valid,true);
  assert.equal(e.resources.valid,true);assert.equal(e.performancePassed,true);assert.equal(f.restored,1);
  assert.equal(f.saved.at(-1).restoration.verified,true);
});

test('partial receipts, malformed SQL, late recovery and DLT changes cannot pass by lag zero',async()=>{
  for(const change of [f=>f.receipts.pop(),f=>f.snapshot.rows[0].ledgers=[],
    f=>f.io.snapshot=async()=>{throw Error('SQL secret');},f=>f.io.receipts=async()=>({records:[],invalid:1}),
    f=>{let n=0;f.io.dlt=async()=>[n++,0,0];},f=>{f.io.now=(()=>{let n=0;return()=>n+=10000;})();f.snapshot.requestCount=0;}]){
    const f=fake();change(f);const e=await collectFocused('smoke',f.io);
    assert.equal(e.valid,false);assert.equal(f.restored,1);assert.equal(JSON.stringify(e).includes('secret'),false);
  }
});

test('load failure, resource pressure and failed restoration preserve sanitized partial evidence',async()=>{
  for(const change of [f=>f.io.start=async()=>({done:Promise.reject(Error('token-secret')),stop:async()=>{}}),
    f=>f.io.cpu=async()=>({cpu:95,pressure:1}),f=>f.io.containers=async()=>({oom:true,memoryBytes:1000}),
    f=>f.io.restore=async()=>{throw Error('restore-secret');}]){
    const f=fake();change(f);const e=await collectFocused('smoke',f.io);
    assert.equal(e.valid,false);assert.ok(f.saved.length>0);assert.equal(JSON.stringify(e).includes('secret'),false);
  }
});

test('performance failure is separate from valid collection and SQL, and preexisting lag prevents load',async()=>{
  const f=fake();f.io.summary=async()=>({count:10,iterations:10,received:10,p50:10,p95:301,p99:310,errorRate:0});
  const e=await collectFocused('smoke',f.io);assert.equal(e.valid,false);assert.equal(e.consistency.valid,true);
  assert.equal(e.observationValid,true);assert.equal(e.performancePassed,false);
  const g=fake();g.lag[0].lag=1;g.io.start=async()=>{assert.fail('must not submit');};
  assert.equal((await collectFocused('smoke',g.io)).valid,false);assert.equal(g.restored,1);
});

test('artifact write failure still restores the owned runtime and cannot report success',async()=>{
  const f=fake();f.io.save=async()=>{throw Error('disk full');};
  await assert.rejects(collectFocused('smoke',f.io));assert.equal(f.restored,1);
});

test('malformed summary values and unconfirmed counter totals are not performance success',async()=>{
  for(const bad of [{p95:-1},{p50:100,p95:20},{p99:null},{errorRate:-1},{count:9},{iterations:9},{received:9}]){
    const f=fake();f.io.summary=async()=>({count:10,iterations:10,received:10,p50:10,p95:20,p99:25,errorRate:0,...bad});
    assert.equal((await collectFocused('smoke',f.io)).valid,false);
  }
});

test('receipt parser strips arbitrary payload and preserves an invalid receipt as failure',()=>{
  const r={...planFocused('fake19','smoke',1,0),requestId:id(10),httpStatus:202,receiptStatus:'RECEIVED',durationMs:2,secret:'token-secret'};
  assert.equal(JSON.stringify(parseReceipt(JSON.stringify(r),'fake19','smoke')).includes('secret'),false);
  r.requestId='token-secret';assert.equal(parseReceipt(JSON.stringify(r),'fake19','smoke').requestId,null);
  assert.throws(()=>parseReceipt('{bad','fake19','smoke'));
  r.key='foreign';assert.throws(()=>parseReceipt(JSON.stringify(r),'fake19','smoke'));
});

test('output claim rejects repository, existing and symlink targets without overwriting',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bidflow-focused-test.')),file=join(dir,'keep');await writeFile(file,'keep');
  await assert.rejects(claimOutput(file));assert.equal(await readFile(file,'utf8'),'keep');
  await assert.rejects(claimOutput(join(process.cwd(),'forbidden-focused-output')));
  await symlink(process.cwd(),join(dir,'repo'));await assert.rejects(claimOutput(join(dir,'repo','forbidden-focused-output')));
  const output=await claimOutput(join(dir,'fresh'));assert.equal(output,join(await realpath(dir),'fresh'));
});
