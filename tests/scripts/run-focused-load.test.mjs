import test from 'node:test';
import assert from 'node:assert/strict';
import {buildK6Args,memoryBytes,executeObserved} from '../../scripts/run-focused-load.mjs';
import {createCommandTrace} from '../../scripts/command-trace.mjs';
test('Docker load args mount source read-only and only the private output as writable',()=>{
  const f={runId:'safe19',auctionId:'00000000-0000-4000-8000-000000000001'};
  const args=buildK6Args('/repo','/tmp/fresh',f,'smoke');
  assert.ok(args.includes('/repo:/work:ro'));assert.ok(args.includes('/tmp/fresh:/results:rw'));
  assert.ok(args.includes('BIDFLOW_BASE_URL=http://host.docker.internal:8080'));
  assert.ok(args.includes('BIDFLOW_FOCUSED_MODE=smoke'));assert.ok(args.includes('--console-output'));
  assert.equal(args.filter(x=>x==='-e').length,5);
  for(const change of [x=>x.runId='../bad',x=>x.auctionId="bad'id"]){const x={...f};change(x);assert.throws(()=>buildK6Args('/repo','/tmp/fresh',x,'full'));}
  assert.throws(()=>buildK6Args('/repo','/tmp/target:rw',f,'full'));
});
test('memory parser understands Docker bytes and refuses missing or malformed memory',()=>{
  assert.equal(memoryBytes('1.5GiB / 8GiB'),1.5*1024**3);
  assert.equal(memoryBytes('20MiB / 8GiB'),20*1024**2);
  assert.equal(memoryBytes('100B / 8GiB'),100);
  for(const input of ['', 'secret','0B / 8GiB','1XB / 8GiB'])assert.throws(()=>memoryBytes(input));
});

test('real executor keeps stdout/exit status and confirms its own deadline without retaining output',async()=>{
  const trace=createCommandTrace({now:()=>performance.now(),execute:executeObserved});
  const r=await trace.run('SETUP_METADATA',process.execPath,['-e','process.stdout.write("stdout-secret")'],5000);
  assert.equal(r.stdout,'stdout-secret');
  await assert.rejects(trace.run('SETUP_METADATA',process.execPath,['-e','process.exit(7)'],5000),e=>e.code===7);
  await assert.rejects(trace.run('SETUP_METADATA',process.execPath,['-e','process.stdout.write("x".repeat(4000100))'],5000),
    e=>e.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  await assert.rejects(trace.run('SETUP_METADATA',process.execPath,['-e','setInterval(()=>{},1000)'],30));
  const s=trace.snapshot();assert.equal(s.complete,true);
  assert.deepEqual(s.records.map(r=>r.outcome),['SUCCEEDED','FAILED','OUTPUT_LIMIT','TIMED_OUT']);
  assert.equal(JSON.stringify(s).includes('secret'),false);
});
