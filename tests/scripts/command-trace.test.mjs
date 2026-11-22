import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandTrace,summarizeTrace,summarizePhases} from '../../scripts/command-trace.mjs';

const entry=(id=1)=>({commandId:id,operation:'KAFKA_LAG',startedMs:id,completedMs:id+1,durationMs:1,
  timeoutMs:12000,outcome:'SUCCEEDED',exitCode:0,signal:null});

test('successful command is called once and preserves the original result without copying input/output secrets',async()=>{
  let tick=0,calls=0;const result={stdout:'stdout-secret',stderr:'stderr-secret'};
  const trace=createCommandTrace({now:()=>++tick,execute:async(...args)=>{calls++;assert.equal(args[1][0],'arg-secret');return result;}});
  assert.equal(await trace.run('KAFKA_LAG','program-secret',['arg-secret'],12000),result);assert.equal(calls,1);
  assert.equal(trace.snapshot().complete,true);assert.equal(trace.snapshot().successful,true);
  assert.equal(JSON.stringify(trace.snapshot()).includes('secret'),false);
  const copy=trace.snapshot();copy.records[0].operation='corrupted';assert.equal(trace.snapshot().complete,true);
});

test('original failures are rethrown by identity and termination alone is not a timeout',async()=>{
  for(const [error,outcome] of [[Error('message-secret'),'FAILED'],
    [Object.assign(Error('message-secret'),{killed:true,signal:'SIGTERM'}),'TERMINATED'],
    [Object.assign(Error('message-secret'),{killed:true,code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'}),'OUTPUT_LIMIT']]){
    let tick=0;const trace=createCommandTrace({now:()=>++tick,execute:async()=>{throw error;}});
    await assert.rejects(trace.run('CONTAINER_STATS','secret',[],5000),e=>e===error);
    assert.equal(trace.snapshot().records[0].outcome,outcome);assert.equal(trace.snapshot().complete,true);
    assert.equal(trace.snapshot().successful,false);assert.equal(JSON.stringify(trace.snapshot()).includes('secret'),false);
  }
});

test('only an explicit executor deadline marker confirms a timeout',async()=>{
  let tick=0;const error=Object.assign(Error('secret'),{killed:true,signal:'SIGTERM'});
  const trace=createCommandTrace({now:()=>tick,execute:async(p,a,{onTimeout})=>{tick=5000;onTimeout();throw error;}});
  await assert.rejects(trace.run('CONTAINER_STATS','docker',[],5000),e=>e===error);
  assert.equal(trace.snapshot().records[0].outcome,'TIMED_OUT');
  assert.equal(trace.snapshot().records[0].durationMs,5000);
});

test('concurrent commands keep their start IDs when the second completes first, with pending state visible',async()=>{
  let tick=0,finishA,finishB;
  const trace=createCommandTrace({now:()=>++tick,execute:(p)=>new Promise(resolve=>{if(p==='a')finishA=resolve;else finishB=resolve;})});
  const a=trace.run('CONTAINER_STATS','a',[],5000),b=trace.run('KAFKA_LAG','b',[],12000);
  assert.equal(trace.snapshot().complete,false);finishB({stdout:'b'});await b;finishA({stdout:'a'});await a;
  const s=trace.snapshot();assert.equal(s.complete,true);assert.equal(s.records[0].commandId,1);
  assert.ok(s.records[0].completedMs>s.records[1].completedMs);
});

test('invalid clock, missing/duplicate IDs and incomplete entries never become complete traces',async()=>{
  for(const records of [[],[entry(2)],[entry(),entry()],[{...entry(),completedMs:null,outcome:'PENDING'}],
    [{...entry(),completedMs:0}],[{...entry(),durationMs:99}],[{...entry(),timeoutMs:NaN}],
    [{...entry(),signal:undefined}]]){
    assert.equal(summarizeTrace({records,clockValid:true,truncated:false}).complete,false);
  }
  for(const ticks of [[3,2],[NaN,2],[1,Infinity]]){
    const trace=createCommandTrace({now:()=>ticks.shift(),execute:async()=>({stdout:'ok'})});
    await trace.run('SETUP_METADATA','x',[],5000);assert.equal(trace.snapshot().complete,false);
  }
});

test('512 limit is explicit and does not prevent a cleanup command or silently erase history',async()=>{
  let tick=0,calls=0;const trace=createCommandTrace({now:()=>++tick,execute:async()=>{calls++;return {stdout:'ok'};}});
  for(let i=0;i<513;i++)await trace.run('CONTAINER_OOM','docker',[],5000);
  assert.equal(calls,513);const s=trace.snapshot();assert.equal(s.records.length,512);assert.equal(s.truncated,true);
  assert.equal(s.records[0].commandId,1);assert.equal(s.complete,false);
  await assert.rejects(trace.run('operation-secret','x',[],5000));assert.equal(calls,513);
});

test('malformed allowed fields are sanitized as well as marked incomplete',()=>{
  for(const field of ['operation','outcome','signal','startedMs','exitCode']){
    const record={...entry(),[field]:'token-secret'};
    const s=summarizeTrace({records:[record],clockValid:true,truncated:false});
    assert.equal(s.complete,false);assert.equal(JSON.stringify(s).includes('secret'),false);
  }
});

test('HTTP phases preserve only numbers, keep missing/invalid data unconfirmed and do not change duration criteria',()=>{
  const metrics=Object.fromEntries(['blocked','connecting','sending','waiting','receiving'].map(p=>[
    'http_req_'+p,{values:{med:1,'p(95)':2,'p(99)':3},secret:'secret'}]));
  const before=structuredClone(metrics),s=summarizePhases(metrics);assert.equal(s.complete,true);
  assert.deepEqual(s.phases.waiting,{p50:1,p95:2,p99:3});assert.deepEqual(metrics,before);
  assert.equal(JSON.stringify(s).includes('secret'),false);
  for(const value of [undefined,-1,NaN,Infinity]){
    const m=structuredClone(metrics);m.http_req_waiting.values['p(95)']=value;
    const r=summarizePhases(m);assert.equal(r.complete,false);assert.equal(r.phases.waiting.p95,null);
  }
  assert.equal(summarizePhases({}).complete,false);
  const m=structuredClone(metrics);m.http_req_waiting.values.med=4;assert.equal(summarizePhases(m).complete,false);
});
