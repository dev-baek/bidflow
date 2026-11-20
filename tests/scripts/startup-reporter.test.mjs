import test from 'node:test';
import assert from 'node:assert/strict';
import Reporter from '../../scripts/startup-reporter.mjs';
const titles=['등록한 경매에 입찰이 없으면 마감에 공개 유찰로 바뀐다','자동 입찰로 확정된 낙찰은 마감 이후 새 입찰로 바뀌지 않는다'];
const tests=titles.map(title=>({title,retries:0,location:{file:'/repo/apps/web/e2e/listing-registration.spec.ts'}}));
const make=()=>{const lines=[];return {lines,reporter:new Reporter({write:line=>lines.push(JSON.parse(line))})};};
test('reporter emits only fixed case metadata and sanitized chunked auction markers',()=>{
 const {lines,reporter}=make();
 reporter.onBegin({workers:1},{allTests:()=>tests});reporter.onTestBegin(tests[0],{retry:0});
 reporter.onStdOut('token-secret\n{"startupObservation":"auction","auctionId":"00000000-0000-4000-8000-000000000001",');
 reporter.onStdOut('"payload":"token-secret"}\n');
 reporter.onTestEnd(tests[0],{status:'timedOut',duration:15000,error:{message:'token-secret'}});
 assert.equal(lines[0].caseId,'unsold');assert.equal(lines[1].startupObservation,'auction');
 assert.equal(lines[2].status,'timedOut');assert.equal(JSON.stringify(lines).includes('secret'),false);
});
test('invalid selection, parallelism, retries and invalid stdout do not masquerade as valid input',()=>{
 for(const [workers,selection,code] of [[2,tests,'INVALID_WORKERS'],[1,tests.slice(0,1),'INVALID_SELECTION']]){
  const {lines,reporter}=make();reporter.onBegin({workers},{allTests:()=>selection});assert.equal(lines[0].code,code);
 }
 const {lines,reporter}=make();reporter.onBegin({workers:1},{allTests:()=>tests});
 reporter.onTestBegin(tests[0],{retry:1});assert.equal(lines[0].code,'UNEXPECTED_RETRY');
 const other=make();other.reporter.onStdOut('{"startupObservation":"auction","auctionId":"secret"}\n');
 assert.equal(other.lines[0].code,'PROCESS_FAILED');
});
