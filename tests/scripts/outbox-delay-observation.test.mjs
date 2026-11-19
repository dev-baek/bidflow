import test from 'node:test';
import assert from 'node:assert/strict';
import {parseObservation, summarizeWindow, windowMarker} from '../../scripts/outbox-delay-observation.mjs';

const poll = (count = '0') => ({logger_name:'com.bidflow.runtime.OutboxScheduler',event:'outbox.poll.completed',outcome:'SUCCEEDED',publishedCount:count,durationMs:'2'});
const record = (data, receivedMs, line) => ({source:'fixture',line,receivedMs,...parseObservation(JSON.stringify(data))});
const marker = (edge, at, line) => record(JSON.parse(windowMarker('bid',edge)),at,line);
const cpu = value => ({bidflowObservation:'cpu',container:'bidflow-local-postgres-1',cpu:value});

test('sanitizes inputs, distinguishes failures and rejects malformed observations', () => {
  assert.equal(parseObservation('gradle startup'),null);
  assert.equal(parseObservation('{"message":"token-secret"}'),null);
  assert.deepEqual(parseObservation(JSON.stringify({...poll(),payload:'secret'})),{kind:'poll',data:{outcome:'SUCCEEDED',publishedCount:0,durationMs:2}});
  assert.throws(()=>parseObservation(JSON.stringify(poll(''))));
  assert.throws(()=>parseObservation(JSON.stringify({...poll(),durationMs:'NaN'})));
  assert.throws(()=>parseObservation(JSON.stringify({...poll(),outcome:'FAILED'})));
  assert.throws(()=>parseObservation(JSON.stringify(cpu('-1%'))));
  assert.throws(()=>parseObservation(JSON.stringify({...cpu('1%'),container:'other'})));
  assert.equal(parseObservation(JSON.stringify(cpu('250.50%'))).data.cpuPercent,250.5);
  assert.throws(()=>windowMarker('other','open'));
  assert.equal(parseObservation(JSON.stringify({...poll(),durationMs:'1.0E-6'})).data.durationMs,0.000001);
});

test('preserves only allowed event fields for later request/event joins', () => {
  const event={logger_name:'com.bidflow.runtime.OutboxTimingLog',event:'event.published',eventId:'event',correlationId:'request',eventType:'BidAccepted',topic:'bid-event',outcome:'PUBLISHED',payload:'secret',key:'secret',batchWaitMs:'0.01'};
  const result=parseObservation(JSON.stringify(event));
  assert.equal(result.kind,'event');
  assert.equal(result.data.eventId,'event');
  assert.equal(result.data.batchWaitMs,'0.01');
  assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('counts only a marked window and reports insufficient CPU separately', () => {
  const records=[record(poll('9'),0,1),marker('open',10,2),record(poll(),20,3),record(cpu('1%'),30,4),record(poll('2'),40,5),marker('close',1010,6),record(poll('9'),1020,7)];
  const s=summarizeWindow(records,'bid');
  assert.equal(s.completedPolls,2); assert.equal(s.emptyPolls,1); assert.equal(s.publishedCount,2);
  assert.equal(s.pollsPerSecond,2); assert.equal(s.emptyRatio,0.5); assert.equal(s.valid,true);
  assert.equal(s.cpu.sufficient,false); assert.equal(s.cpu.median,1);
  assert.equal(s.duration.p95,2);
});

test('rejects missing/reversed/duplicate boundaries, duplicate source rows and bad clocks', () => {
  const good=[marker('open',0,1),record(poll(),1,2),marker('close',10,3)];
  assert.throws(()=>summarizeWindow(good.slice(1),'bid'));
  assert.throws(()=>summarizeWindow([...good,marker('close',11,4)],'bid'));
  assert.throws(()=>summarizeWindow([good[0],{...good[1],receivedMs:-1},good[2]],'bid'));
  assert.throws(()=>summarizeWindow([good[0],good[1],{...good[1]},good[2]],'bid'));
  assert.throws(()=>summarizeWindow([marker('open',0,1),marker('close',0,2)],'bid'));
});

test('empty polls, failures, missing timing and idle contamination cannot be valid comparisons', () => {
  assert.equal(summarizeWindow([marker('open',0,1),marker('close',10,2)],'bid').valid,false);
  const failure={logger_name:'com.bidflow.runtime.OutboxScheduler',event:'outbox.poll.completed',outcome:'FAILED'};
  const s=summarizeWindow([marker('open',0,1),record(failure,1,2),marker('close',10,3)],'bid');
  assert.equal(s.valid,false); assert.equal(s.publishedCount,null); assert.equal(s.emptyRatio,null);
  const missing={...poll()};delete missing.durationMs;
  assert.equal(summarizeWindow([marker('open',0,1),record(missing,1,2),marker('close',10,3)],'bid').valid,false);
  const idle=[record(JSON.parse(windowMarker('idle','open')),0,1),record(poll('1'),1,2),record(JSON.parse(windowMarker('idle','close')),10,3)];
  assert.equal(summarizeWindow(idle,'idle').valid,false);
});

test('CPU median and threshold use only samples in this window', () => {
  const rows=[marker('open',0,1),record(poll(),1,2),...['1%','5%','3%','4%','2%','6%'].map((v,i)=>record(cpu(v),i+2,i+3)),marker('close',1000,9)];
  const s=summarizeWindow(rows,'bid');
  assert.deepEqual(s.cpu,{count:6,sufficient:true,median:3.5,max:6});
});
