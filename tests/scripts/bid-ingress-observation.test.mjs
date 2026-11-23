import test from 'node:test';
import assert from 'node:assert/strict';
import {joinBidIngress,diagnosticCorrelationId} from '../../scripts/bid-ingress-observation.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const receipts=[1,2].map(n=>({correlationId:id(n),requestId:id(3),httpStatus:202,receiptStatus:'RECEIVED',durationMs:n+3}));
const logs=receipts.flatMap(({correlationId,requestId})=>[
  {event:'bid.request.received',correlationId,bidRequestId:requestId,outcome:'RECEIVED'},
  {event:'bid.ingress.timing',correlationId,bidRequestId:requestId,outcome:'HTTP_RETURNED',
    httpStatus:'202',httpNanos:'3000000',receiveStartNanos:'1000000',receiveEndNanos:'2000000',receiveOutcome:'RETURNED',token:'private'},
]);

test('joins separate replays of one request without copying unapproved fields',()=>{
  const result=joinBidIngress(receipts,[...logs,{event:'bid.settled',correlationId:id(1)}]);
  assert.equal(result.complete,true);
  assert.deepEqual(result.samples,receipts.map(({correlationId,requestId,durationMs})=>({
    correlationId,requestId,clientDurationMs:durationMs,serverDurationMs:3,receiveDurationMs:1
  })));
  assert.doesNotMatch(JSON.stringify(result),/token|private/);
});

test('fails closed for missing, duplicate, foreign and inconsistent segments',()=>{
  for(const change of [
    (_,l)=>l.pop(),(_,l)=>l.push(l[0]),(_,l)=>l.push(l[1]),(r)=>r.push(r[0]),r=>r[0].requestId=id(8),
    r=>r[0].correlationId='bad',(_,l)=>l[1].receiveEndNanos='4000000',
    (_,l)=>l[1].httpNanos='3e6',(_,l)=>l[1].receiveStartNanos='-1',
    (_,l)=>l[1].receiveOutcome='THREW',(_,l)=>l[1].httpStatus='200',
  ]){
    const r=structuredClone(receipts),l=structuredClone(logs);change(r,l);
    assert.equal(joinBidIngress(r,l).complete,false);
  }
  assert.equal(diagnosticCorrelationId(id(1)+'\n'),null);
  assert.equal(diagnosticCorrelationId([id(1),id(2)]),null);
});
