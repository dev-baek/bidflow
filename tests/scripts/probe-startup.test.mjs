import test from 'node:test';import assert from 'node:assert/strict';
import {probeStartup} from '../../scripts/probe-startup.mjs';
test('health alone does not gate, readiness starts without an extra sleep',async()=>{
 const events=[];let time=0,calls=0,waits=0;
 const ready=await probeStartup({emit:e=>events.push(e),now:()=>time,wait:async ms=>{waits++;time+=ms;},timeoutMs:1000,
  fetchImpl:async(url,options)=>{assert.ok(options.signal);time+=10;calls++;return {status:calls===2?503:200,json:async()=>({status:calls===2?'OUT_OF_SERVICE':'UP',payload:'secret'})};}});
 assert.equal(ready,true);assert.equal(calls,4);assert.equal(waits,1);
 assert.equal(events.at(-1).endpoint,'readiness');assert.equal(events.at(-1).status,'UP');
 assert.equal(JSON.stringify(events).includes('secret'),false);
});
test('transport errors and malformed statuses remain sanitized failures at the deadline',async()=>{
 for(const error of [new DOMException('token-secret','TimeoutError'),new Error('token-secret'),null]){
  const events=[];let time=0;
  const ready=await probeStartup({emit:e=>events.push(e),now:()=>time,wait:async ms=>{time+=ms;},timeoutMs:500,
   fetchImpl:async()=>{time+=50;if(error)throw error;return {status:200,json:async()=>({status:'token-secret'})};}});
  assert.equal(ready,false);assert.equal(events.at(-1).code,'PROBE_TIMEOUT');
  assert.ok(events.some(e=>e.error===(error?.name==='TimeoutError'?'TIMEOUT':error?'CONNECTION_FAILED':'INVALID_RESPONSE')));
  assert.equal(JSON.stringify(events).includes('secret'),false);
 }
});
test('invalid limits are rejected before service access',async()=>{
 await assert.rejects(probeStartup({emit:()=>{},timeoutMs:0,fetchImpl:()=>{throw Error('called');}}));
});
