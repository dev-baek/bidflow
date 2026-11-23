import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {setTimeout as wait} from 'node:timers/promises';
import {mkdtemp,writeFile,readFile,symlink,realpath,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planFocused} from '../../scripts/focused-thousand.mjs';
import {collectFocused,claimOutput,parseReceipt} from '../../scripts/focused-load-collector.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const phaseMetrics=Object.fromEntries(['blocked','connecting','sending','waiting','receiving'].map(p=>
  ['http_req_'+p,{values:{med:1,'p(95)':2,'p(99)':3}}]));
const traceEntry=(n=1)=>({commandId:n,operation:'SETUP_METADATA',startedMs:n,completedMs:n+1,durationMs:1,
  timeoutMs:5000,outcome:'SUCCEEDED',exitCode:0,signal:null});
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
    readiness:async()=>({auctionId,requestCount:10,completedCount:10}),
    trace:()=>({records:[traceEntry()],clockValid:true,truncated:false}),
    summary:async()=>({count:10,iterations:10,received:10,p50:10,p95:20,p99:25,errorRate:0,phaseMetrics})};
  return {io,receipts,snapshot,lag,get restored(){return restored;},get stopped(){return stopped;},get saved(){return saved;}};
}

test('collector joins a complete smoke without pretending it is a thousand-request result and always restores',async()=>{
  const f=fake(),e=await collectFocused('smoke',f.io);
  assert.equal(e.valid,true);assert.equal(e.fullVerified,false);assert.equal(e.consistency.valid,true);
  assert.equal(e.resources.valid,true);assert.equal(e.performancePassed,true);assert.equal(f.restored,1);
  assert.equal(f.saved.at(-1).restoration.verified,true);
  assert.equal(e.diagnosticsComplete,true);assert.equal(e.commandTrace.complete,true);assert.equal(e.phaseSummary.complete,true);
});

test('checks fresh lag then scoped counts before doing the full snapshot exactly once',async()=>{
  const f=fake(),zero=f.lag,positive=[{...zero[0],endOffset:1,lag:1},...zero.slice(1)];
  let recovery=false,lagCalls=0,readyCalls=0,snapshots=0;
  const summary=f.io.summary,snapshot=f.io.snapshot,readiness=f.io.readiness;
  f.io.summary=async()=>{recovery=true;return summary();};
  f.io.lag=async()=>recovery&&++lagCalls===1?positive:zero;
  f.io.readiness=async()=>{
    assert.equal(lagCalls,++readyCalls+1);
    return {...await readiness(),completedCount:readyCalls===1?9:10,secret:'discard-me'};
  };
  f.io.snapshot=async()=>{assert.equal(readyCalls,2);snapshots++;return snapshot();};
  const e=await collectFocused('smoke',f.io);
  assert.equal(e.valid,true);assert.equal(snapshots,1);assert.equal(lagCalls,4);
  assert.deepEqual(e.readinessChecks.map(x=>x.completedCount),[9,10]);
  assert.doesNotMatch(JSON.stringify(e),/discard-me/);
});

test('does not start a snapshot on lag, pending, invalid or late readiness',async()=>{
  for(const condition of ['lag','late-lag','pending','invalid','foreign','error','late']){
    const f=fake(),zero=f.lag;let recovery=false,offset=0,reads=0,snapshots=0;
    const summary=f.io.summary,readiness=f.io.readiness,wait=f.io.wait;
    f.io.summary=async()=>{recovery=true;return summary();};
    f.io.now=()=>performance.now()+offset;
    f.io.wait=async ms=>{if(recovery){offset+=40000;return;}return wait(ms);};
    f.io.lag=async()=>{
      if(recovery&&condition==='late-lag')offset+=60000;
      return recovery&&condition==='lag'?[{...zero[0],endOffset:1,lag:1},...zero.slice(1)]:zero;
    };
    f.io.readiness=async()=>{
      reads++;
      if(condition==='error')throw Error('secret');
      if(condition==='late')offset+=60000;
      const r=await readiness();
      return condition==='pending'?{...r,completedCount:9}:condition==='invalid'?{...r,requestCount:11}
        :condition==='foreign'?{...r,auctionId:id(9)}:r;
    };
    f.io.snapshot=async()=>{snapshots++;return f.snapshot;};
    const e=await collectFocused('smoke',f.io);
    assert.equal(e.valid,false,condition);assert.equal(snapshots,0,condition);assert.equal(f.restored,1,condition);
    assert.equal(reads,['lag','late-lag'].includes(condition)?0:condition==='pending'?2:1,condition);
    assert.doesNotMatch(JSON.stringify(e),/secret/);
  }
});

test('does not retry snapshot on post-audit lag, invalid ledger, or SQL failure',async()=>{
  for(const fail of ['lag','ledger','sql']){
    const f=fake();let recovery=false,lagCalls=0,snapshots=0;
    const summary=f.io.summary;
    f.io.summary=async()=>{recovery=true;return summary();};
    f.io.lag=async()=>recovery&&++lagCalls>=2&&fail==='lag'
      ?[{...f.lag[0],endOffset:1,lag:1},...f.lag.slice(1)]:f.lag;
    f.io.snapshot=async()=>{
      snapshots++;
      if(fail==='sql')throw Object.assign(Error('secret'),{code:'SQL_QUERY_CANCELED'});
      if(fail==='ledger')f.snapshot.rows[0].ledgers=[];
      return f.snapshot;
    };
    const e=await collectFocused('smoke',f.io);
    assert.equal(e.valid,false,fail);assert.equal(snapshots,1,fail);assert.equal(f.restored,1,fail);
    assert.equal(e.recoveredMs,undefined,fail);
    assert.doesNotMatch(JSON.stringify(e),/secret/);
  }
});

test('optional observer gates load, stops on disconnect and preserves partial evidence and restoration',async()=>{
  for(const scenario of ['prepare','lost','finish','close','readiness','sql','pass']){
    const f=fake();let started=false,lost=false,closed=false;
    const start=f.io.start;
    f.io.start=async()=>{started=true;lost=scenario==='lost';return start();};
    const observer={
      prepare:async()=>{if(scenario==='prepare')throw Error('private');},
      error:()=>lost?'SOCKET_LOST':null,
      finish:async e=>({valid:scenario!=='finish'&&e.consistency.valid}),
      freeze:()=>({frames:[],screenChecks:[{role:'A',atMs:2}],error:null}),
      close:async()=>{closed=true;if(['close','sql'].includes(scenario))throw Error('private');},
    };
    if(scenario==='sql')f.io.snapshot=async()=>{throw Object.assign(Error('private'),{code:'SQL_QUERY_CANCELED'});};
    if(scenario==='readiness')f.io.readiness=async()=>{throw Error('private');};
    const e=await collectFocused('smoke',f.io,observer);
    assert.equal(started,scenario!=='prepare');assert.equal(closed,true);assert.equal(f.restored,1);
    assert.equal(e.valid,scenario==='pass');assert.equal(e.browserObservationValid,scenario==='pass');
    if(scenario==='lost')assert.equal(f.stopped>0,true);
    assert.deepEqual(e.browserEvidence.screenChecks,[{role:'A',atMs:2}]);
    if(scenario==='sql')assert.ok(e.failures.some(x=>x.source==='snapshot'&&x.code==='SQL_QUERY_CANCELED'));
    if(scenario==='readiness')assert.ok(e.failures.some(x=>x.source==='readiness'));
    if(['sql','close'].includes(scenario))assert.ok(e.failures.some(x=>x.source==='browser-close'));
    assert.deepEqual(f.saved.at(-1).browserEvidence,e.browserEvidence);
    assert.doesNotMatch(JSON.stringify(e),/private/);
  }
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
    f=>{let finish;f.io.cpu=async()=>({cpu:95,pressure:1});
      f.io.start=async()=>({done:new Promise(resolve=>{finish=resolve;}),stop:async()=>finish(105)});},
    f=>f.io.containers=async()=>({oom:true,memoryBytes:1000}),
    f=>f.io.restore=async()=>{throw Error('restore-secret');}]){
    const f=fake();change(f);const e=await collectFocused('smoke',f.io);
    assert.equal(e.valid,false);assert.ok(f.saved.length>0);assert.equal(JSON.stringify(e).includes('secret'),false);
  }
});

test('performance failure is separate from valid collection and SQL, and preexisting lag prevents load',async()=>{
  const f=fake();f.io.summary=async()=>({count:10,iterations:10,received:10,p50:10,p95:301,p99:310,errorRate:0,phaseMetrics});
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
    const f=fake();f.io.summary=async()=>({count:10,iterations:10,received:10,p50:10,p95:20,p99:25,errorRate:0,phaseMetrics,...bad});
    assert.equal((await collectFocused('smoke',f.io)).valid,false);
  }
});

test('sampler termination retains source without inferring a timeout or raw command output',async()=>{
  const f=fake();let calls=0;
  f.io.containers=async()=>{if(++calls>1)throw Object.assign(Error('token-secret'),{killed:true});return {oom:false,memoryBytes:1000};};
  const e=await collectFocused('smoke',f.io);assert.equal(e.valid,false);
  assert.ok(e.failures.some(x=>x.source==='containers'&&x.kind==='TERMINATED'));
  assert.equal(JSON.stringify(e).includes('secret'),false);
});

test('missing/truncated/corrupt trace or missing HTTP phases cannot turn a good SQL result into full success',async()=>{
  for(const change of [f=>delete f.io.trace,f=>f.io.trace=()=>({records:[],truncated:true,clockValid:true}),
    f=>f.io.trace=()=>({records:[traceEntry(2)],clockValid:true,truncated:false}),
    f=>{const summary=f.io.summary;f.io.summary=async()=>({...await summary(),phaseMetrics:{}}); }]){
    const f=fake();change(f);const e=await collectFocused('smoke',f.io);
    assert.equal(e.valid,false);assert.equal(e.consistency.valid,true);assert.equal(e.performancePassed,true);
    assert.equal(e.diagnosticsComplete,false);assert.equal(e.observationValid,false);assert.equal(f.restored,1);
  }
});

test('trace is captured before saving partial evidence and refreshed after restoration commands',async()=>{
  const f=fake(),records=[traceEntry()];f.io.trace=()=>({records,clockValid:true,truncated:false});
  f.io.restore=async()=>{records.push(traceEntry(2));return {verified:true};};
  const e=await collectFocused('smoke',f.io);
  assert.equal(f.saved[0].commandTrace.records.length,1);assert.equal(e.commandTrace.records.length,2);assert.equal(e.valid,true);
});

test('receipt parser strips arbitrary payload and preserves an invalid receipt as failure',()=>{
  const r={...planFocused('fake19','smoke',1,0),requestId:id(10),httpStatus:202,receiptStatus:'RECEIVED',durationMs:2,secret:'token-secret'};
  assert.equal(parseReceipt(JSON.stringify(r),'fake19','smoke').correlationId,null);
  assert.equal(parseReceipt(JSON.stringify({...r,correlationId:id(20)}),'fake19','smoke').correlationId,id(20));
  assert.equal(parseReceipt(JSON.stringify({...r,correlationId:'token-secret'}),'fake19','smoke').correlationId,null);
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

test('output claim also protects other Git worktrees and rejects Docker mount delimiter paths',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bidflow-focused-other.'));
  await mkdir(join(dir,'repo'));await writeFile(join(dir,'repo','.git'),'gitdir: /unused');
  await assert.rejects(claimOutput(join(dir,'repo','result')));
  for(const name of ['bad:rw','bad,bind','bad\nname'])await assert.rejects(claimOutput(join(dir,name)));
});
