import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStartupLine, summarizeStartup, readyForTests, startupCaseId} from '../../scripts/startup-observation.mjs';
const id='00000000-0000-4000-8000-000000000001';
const marker=(event,data={})=>({startupObservation:event,...data});
const row=(value,ms,line)=>({source:'fixture',line,receivedMs:ms,...parseStartupLine(JSON.stringify(value))});
const records=()=>[
 row(marker('old.exited',{pid:10}),0,1),row(marker('api.started',{pid:20}),1,2),
 row(marker('probe',{endpoint:'health',httpStatus:200,status:'UP'}),2,3),
 row(marker('probe',{endpoint:'readiness',httpStatus:200,status:'UP'}),3,4),
 row(marker('test.begin',{caseId:'unsold'}),4,5),row(marker('auction',{auctionId:id}),5,6),
 row(marker('test.end',{caseId:'unsold',status:'passed',durationMs:10}),6,7),
 row(marker('test.begin',{caseId:'auto-finalization'}),7,8),
 row(marker('test.end',{caseId:'auto-finalization',status:'passed',durationMs:20}),8,9),
 row(marker('runner.exit',{code:0}),9,10),row(marker('api.stopped',{pid:20}),10,11),row(marker('restored',{pid:30}),11,12),
];
test('only readiness 200 UP without transport error permits tests',()=>{
 assert.equal(readyForTests({endpoint:'health',httpStatus:200,status:'UP'}),false);
 assert.equal(readyForTests({endpoint:'readiness',httpStatus:503,status:'UP'}),false);
 assert.equal(readyForTests({endpoint:'readiness',httpStatus:200,status:'UP',error:'TIMEOUT'}),false);
 assert.equal(readyForTests({endpoint:'readiness',httpStatus:200,status:'UP'}),true);
});
test('sanitizes assignment logs and keeps unknown or empty assignments unconfirmed',()=>{
 const log={logger_name:'org.springframework.kafka.listener.KafkaMessageListenerContainer',message:'bid-settlement: partitions assigned: [bid-command-0, bid-command-2]',payload:'token-secret'};
 const parsed=parseStartupLine(JSON.stringify(log));
 assert.deepEqual(parsed,{kind:'kafka',data:{group:'bid-settlement',action:'assigned',partitions:[{topic:'bid-command',partition:0},{topic:'bid-command',partition:2}]}});
 assert.equal(JSON.stringify(parsed).includes('secret'),false);
 assert.deepEqual(parseStartupLine(JSON.stringify({...log,message:'bid-settlement: partitions revoked: []'})).data.partitions,[]);
 for(const message of ['other: partitions assigned: [bid-command-0]','bid-settlement: partitions assigned: [secret-0]','bid-settlement: partitions assigned: ???']){
  assert.equal(parseStartupLine(JSON.stringify({...log,message})).kind,'kafka.unparsed');
 }
 assert.equal(parseStartupLine(JSON.stringify({message:log.message})),null);
 assert.equal(parseStartupLine('framework unrelated token-secret'),null);
});
test('matches only the two existing test titles',()=>{
 assert.equal(startupCaseId('등록한 경매에 입찰이 없으면 마감에 공개 유찰로 바뀐다'),'unsold');
 assert.equal(startupCaseId('자동 입찰로 확정된 낙찰은 마감 이후 새 입찰로 바뀌지 않는다'),'auto-finalization');
 assert.equal(startupCaseId('arbitrary-secret'),null);
 assert.equal(startupCaseId('constructor'),null);
});
test('summarizes a complete observation without claiming cause or Kafka readiness',()=>{
 const summary=summarizeStartup(records());
 assert.equal(summary.testsPassed,true);assert.equal(summary.firstHealthUpMs,2);assert.equal(summary.firstReadinessUpMs,3);
 assert.deepEqual(summary.cases[0].auctionIds,[id]);
 assert.equal(summary.kafka['bid-settlement'].firstNonEmptyAssignmentMs,null);
});
test('business failure remains a valid observation and must match runner exit',()=>{
 const rows=records();rows[6]=row(marker('test.end',{caseId:'unsold',status:'timedOut',durationMs:15000}),6,7);
 rows[9]=row(marker('runner.exit',{code:1}),9,10);
 assert.equal(summarizeStartup(rows).testsPassed,false);
 assert.throws(()=>summarizeStartup([...rows.slice(0,9),records()[9],...rows.slice(10)]));
});
test('rejects health-only gating, wrong process/test order, duplicate sources and clock reversal',()=>{
 const rows=records();
 assert.throws(()=>summarizeStartup(rows.filter(r=>r.line!==4)));
 assert.throws(()=>summarizeStartup(rows.slice(1)));
 assert.throws(()=>summarizeStartup([...rows.slice(0,5),rows[4],...rows.slice(5)]));
 assert.throws(()=>summarizeStartup(rows.map(r=>r.line===6?{...r,receivedMs:0}:r)));
 assert.throws(()=>summarizeStartup(rows.map(r=>r.line===5?row(marker('test.begin',{caseId:'auto-finalization'}),4,5):r)));
 assert.throws(()=>summarizeStartup(rows.slice(0,-1)));
 assert.throws(()=>parseStartupLine(JSON.stringify(marker('probe',{endpoint:'readiness',httpStatus:200,status:'token-secret'}))));
 assert.throws(()=>parseStartupLine(JSON.stringify(marker('auction',{auctionId:'not-uuid'}))));
});

test('assignment and business logs are phase bound and sanitized without implying readiness',()=>{
 const log={logger_name:'org.springframework.kafka.listener.KafkaMessageListenerContainer',message:'bid-settlement: partitions assigned: []'};
 const input=records();
 assert.throws(()=>summarizeStartup([row(log,0,99),...input]));
 const observed=[...input.slice(0,2),row(log,1.2,99),row({...log,message:'bid-settlement: partitions assigned: [bid-command-0]'},1.3,100),...input.slice(2)];
 assert.equal(summarizeStartup(observed).kafka['bid-settlement'].firstNonEmptyAssignmentMs,1.3);
 const settled=parseStartupLine(JSON.stringify({logger_name:'com.bidflow.runtime.DirectBidCommandKafkaListener',event:'bid.settled',eventId:id,bidRequestId:id,auctionId:id,outcome:'ACCEPTED',bidderId:'secret',payload:'secret',message:'secret'}));
 assert.equal(settled.kind,'settlement');assert.equal(JSON.stringify(settled).includes('secret'),false);
 const outbox=parseStartupLine(JSON.stringify({logger_name:'com.bidflow.runtime.OutboxTimingLog',event:'event.published',eventId:id,eventType:'BidAccepted',payload:'secret',key:'secret'}));
 assert.equal(outbox.kind,'outbox');assert.equal(JSON.stringify(outbox).includes('secret'),false);
});
