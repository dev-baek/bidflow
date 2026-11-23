import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {focusedConfig,planFocused,localLoadUrl} from '../../scripts/focused-thousand.mjs';
import {diagnosticCorrelationId} from '../../scripts/bid-ingress-observation.mjs';

function load(env,body={status:'RECEIVED',bidRequestId:'00000000-0000-4000-8000-000000000001'},
    headers={'X-Correlation-Id':'00000000-0000-4000-8000-000000000098'}) {
  const calls=[],logs=[];
  const context={__ENV:{BIDFLOW_BASE_URL:'http://host.docker.internal:8080',BIDFLOW_RUN_ID:'test',
    BIDFLOW_AUCTION_ID:'00000000-0000-4000-8000-000000000002',...env},__VU:1,__ITER:0,
    focusedConfig,planFocused,localLoadUrl,diagnosticCorrelationId,console:{log:s=>logs.push(JSON.parse(s))},
    check:(r,checks)=>Object.values(checks).every(fn=>fn(r)),fail:s=>{throw Error(s);},sleep:()=>{},
    Counter:class {add(){}},Trend:class {add(){}},
    http:{post:(...args)=>{calls.push(args);return {status:202,headers,timings:{duration:12},json:key=>key?body[key]:body};}}};
  const source=readFileSync(new URL('../../tests/load/bid-request.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/export /g,'');
  vm.runInNewContext(source+'\n;globalThis.result={options,focused,distributed,focusedThousand,handleSummary};',context);
  return {calls,logs,...context.result};
}

test('new k6 scenario is bounded, records one receipt and disables redirects',()=>{
  const r=load({BIDFLOW_LOAD_SCENARIO:'focused-thousand'});
  const s=r.options.scenarios.focused_thousand;
  assert.equal(s.vus,20);assert.equal(s.iterations,50);assert.equal(s.maxDuration,'120s');assert.equal(s.gracefulStop,'0s');
  assert.deepEqual(Array.from(r.options.summaryTrendStats),['med','p(95)','p(99)','max']);
  r.focusedThousand();assert.equal(r.calls.length,1);
  assert.equal(r.calls[0][2].timeout,'5s');assert.equal(r.calls[0][2].redirects,0);
  assert.equal(JSON.parse(r.calls[0][1]).amount,60000);
  assert.equal(r.logs.length,1);assert.equal(r.logs[0].requestId,'00000000-0000-4000-8000-000000000001');
  assert.equal(r.logs[0].correlationId,'00000000-0000-4000-8000-000000000098');
  assert.deepEqual(Object.keys(r.handleSummary({})),['/results/summary.json']);
});

test('malformed receipts retain failure without logging arbitrary HTTP fields',()=>{
  const r=load({BIDFLOW_LOAD_SCENARIO:'focused-thousand',BIDFLOW_FOCUSED_MODE:'smoke'},{secret:'do-not-copy'},
    {'X-Correlation-Id':'private-input','Authorization':'do-not-copy'});
  assert.equal(r.options.scenarios.focused_thousand.vus,2);
  r.focusedThousand();assert.equal(r.logs[0].requestId,null);assert.equal(r.logs[0].receiptStatus,null);
  assert.equal(r.logs[0].correlationId,null);
  assert.equal(JSON.stringify(r.logs).includes('do-not-copy'),false);
});

test('legacy focused/distributed contracts remain and new local-only input is enforced',()=>{
  const f=load({BIDFLOW_LOAD_SCENARIO:'focused'});f.focused();
  assert.equal(f.options.scenarios.focused_contention.iterations,1);assert.equal(JSON.parse(f.calls[0][1]).amount,20000);
  assert.equal(f.logs.length,0);
  const d=load({BIDFLOW_LOAD_SCENARIO:'distributed',BIDFLOW_AUCTION_IDS:'a,b'});d.distributed();
  assert.equal(d.options.scenarios.distributed_steady.stages[2].duration,'2m');
  assert.throws(()=>load({BIDFLOW_LOAD_SCENARIO:'focused-thousand',BIDFLOW_BASE_URL:'https://example.com'}));
  assert.throws(()=>load({BIDFLOW_LOAD_SCENARIO:'focused-thousand',BIDFLOW_AUCTION_ID:"bad'id"}));
});
