import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=(output,input='')=>spawnSync(process.execPath,['scripts/collect-outbox-delay.mjs','A1',output],{encoding:'utf8',input,timeout:5000});
test('CLI rejects repository, existing and symlink targets without overwriting',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bidflow-collector-test.'));
  const existing=join(dir,'exists.json');writeFileSync(existing,'keep');
  assert.notEqual(run(existing).status,0);assert.equal(readFileSync(existing,'utf8'),'keep');
  assert.notEqual(run('collector-must-not-exist.json').status,0);
  symlinkSync(process.cwd(),join(dir,'repo'));
  assert.notEqual(run(join(dir,'repo','collector-must-not-exist.json')).status,0);
});
test('CLI sanitizes live input and preserves invalid/incomplete evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bidflow-collector-test.'));
  const output=join(dir,'result.json');
  const result=run(output,'unrelated token-secret\n'+JSON.stringify({bidflowObservation:'window',window:'bid',edge:'open',payload:'token-secret'})+'\n');
  assert.notEqual(result.status,0);
  const evidence=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(evidence.valid,false);assert.equal(evidence.records.length,1);
  assert.equal(JSON.stringify(evidence).includes('token-secret'),false);
});
test('CLI completes ordered windows without pretending insufficient CPU is sufficient',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bidflow-collector-test.'));
  const output=join(dir,'result.json');
  const marker=(window,edge)=>({bidflowObservation:'window',window,edge});
  const poll={logger_name:'com.bidflow.runtime.OutboxScheduler',event:'outbox.poll.completed',outcome:'SUCCEEDED',publishedCount:'0',durationMs:'1.0'};
  const rows=[marker('idle','open'),poll,marker('idle','close'),marker('bid','open'),poll,marker('bid','close')];
  assert.equal(run(output,rows.map(JSON.stringify).join('\n')+'\n').status,0);
  const evidence=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(evidence.valid,true); assert.equal(evidence.costComparisonReady,false);
  const reversed=join(dir,'reversed.json');
  assert.notEqual(run(reversed,[...rows.slice(3),...rows.slice(0,3)].map(JSON.stringify).join('\n')).status,0);
});
