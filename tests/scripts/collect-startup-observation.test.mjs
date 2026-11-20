import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const run=(output,input='')=>spawnSync(process.execPath,['scripts/collect-startup-observation.mjs',output],{encoding:'utf8',input,timeout:5000});
test('collector refuses overwrite and paths inside the repository',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bidflow-startup-test.'));const file=join(dir,'keep.json');writeFileSync(file,'keep');
 assert.notEqual(run(file).status,0);assert.equal(readFileSync(file,'utf8'),'keep');
 symlinkSync(process.cwd(),join(dir,'repo'));assert.notEqual(run(join(dir,'repo','not-created.json')).status,0);
});
test('collector preserves partial sanitized evidence rather than declaring setup success',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bidflow-startup-test.'));const file=join(dir,'partial.json');
 const result=run(file,'token-secret\n{"startupObservation":"api.started","pid":10,"payload":"token-secret"}\n');
 assert.notEqual(result.status,0);const e=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(e.valid,false);assert.equal(e.records.length,1);assert.equal(JSON.stringify(e).includes('secret'),false);
});
test('collector completes both passing and failing business runs without conflating outcomes',()=>{
 const marker=(event,data={})=>({startupObservation:event,...data});
 for(const failed of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'bidflow-startup-test.'));const file=join(dir,'result.json');
  const rows=[marker('old.exited',{pid:10}),marker('api.started',{pid:20}),marker('probe',{endpoint:'readiness',httpStatus:200,status:'UP'}),
   marker('test.begin',{caseId:'unsold'}),marker('test.end',{caseId:'unsold',status:failed?'failed':'passed',durationMs:1}),
   marker('test.begin',{caseId:'auto-finalization'}),marker('test.end',{caseId:'auto-finalization',status:'passed',durationMs:1}),
   marker('runner.exit',{code:failed?1:0}),marker('api.stopped',{pid:20}),marker('restored',{pid:30})];
  assert.equal(run(file,rows.map(JSON.stringify).join('\n')+'\n').status,0);
  const e=JSON.parse(readFileSync(file,'utf8'));assert.equal(e.valid,true);assert.equal(e.summary.testsPassed,!failed);
 }
});
