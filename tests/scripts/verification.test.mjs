import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

function fixture(extra={}) {
  const root=mkdtempSync(join(tmpdir(),'bidflow-verify.'));
  for(const dir of ['scripts','backend','bin'])mkdirSync(join(root,dir));
  copyFileSync('Makefile',join(root,'Makefile'));copyFileSync('scripts/verify.sh',join(root,'scripts/verify.sh'));
  const log=join(root,'calls');writeFileSync(log,'');
  const fake=`#!/bin/sh
name=$(basename "$0")
case "$name:$*" in
java:*) [ "${'${TEST_JAVA_BANNER:-0}'}" = 0 ] || echo 'Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8' >&2
echo "openjdk version \\\"${'${TEST_JAVA_MAJOR:-21}'}.0.7\\\"" >&2; exit 0;;
node:--version) echo "v${'${TEST_NODE_MAJOR:-24}'}.0.0"; exit 0;;
npm:--version) echo 11.0.0; exit 0;;
esac
printf '%s %s\\n' "$name" "$*" >> "$TEST_CALL_LOG"
case "$name" in docker|aws) exit 99;; esac
case "$name:$*" in *"${'${TEST_FAIL_MATCH:-not-a-command}'}"*) exit 7;; esac
exit 0
`;
  for(const name of ['java','node','npm','git','docker','aws'])writeFileSync(join(root,'bin',name),fake,{mode:0o755});
  writeFileSync(join(root,'backend/gradlew'),fake,{mode:0o755});
  const result=spawnSync('make',['-j4','verify'],{cwd:root,encoding:'utf8',timeout:10000,
    env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,JAVA_HOME:'',BIDFLOW_VERIFY_BASE:'',TEST_CALL_LOG:log,...extra}});
  return {result,calls:readFileSync(log,'utf8').trim().split('\n').filter(Boolean)};
}

test('verify runs sequential static, backend, web, scripts and build steps without Docker or AWS',()=>{
  const {result,calls}=fixture();assert.equal(result.status,0,result.stderr);
  const steps=calls.filter(line=>!line.startsWith('git '));
  assert.deepEqual(steps,[
    'gradlew -p backend verifyModuleDependencies','gradlew -p backend unitTest verifyModuleDependencies',
    'npm --prefix apps/web run test:run','node --test tests/scripts/*.test.mjs',
    'gradlew -p backend :runtime:bootJar','npm --prefix apps/web run build',
  ]);
  assert.ok(!calls.some(line=>/^(docker|aws) /.test(line)));
});

test('first failure stops later stages and prints the original failing code',()=>{
  const {result,calls}=fixture({TEST_FAIL_MATCH:'unitTest'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/7/);
  assert.ok(!calls.some(line=>line.startsWith('npm ')));
});

test('Java option banners do not hide a supported Java version',()=>{
  const {result}=fixture({TEST_JAVA_BANNER:'1'});assert.equal(result.status,0,result.stderr);
});

test('unsupported Java/Node and invalid diff base are rejected before tests or build',()=>{
  for(const env of [{TEST_JAVA_MAJOR:'17'},{TEST_NODE_MAJOR:'20'},{BIDFLOW_VERIFY_BASE:'main;unsafe'}]){
    const {result,calls}=fixture(env);assert.notEqual(result.status,0);
    assert.ok(!calls.some(line=>line.includes('unitTest')||line.includes('bootJar')||line.startsWith('npm ')));
  }
});

test('CI has fixed versions, least privilege and the same verification entry point',()=>{
  const yaml=readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(yaml,/pull_request:/);assert.match(yaml,/branches: \[main\]/);
  assert.match(yaml,/contents: read/);assert.match(yaml,/persist-credentials: false/);
  assert.match(yaml,/java-version: '21'/);assert.match(yaml,/node-version: '24'/);
  assert.match(yaml,/timeout-minutes: 20/);assert.match(yaml,/cancel-in-progress: true/);
  assert.match(yaml,/run: make verify/);assert.match(yaml,/npm --prefix apps\/web ci/);
  const actions=[...yaml.matchAll(/uses: (actions\/(?:checkout|setup-java|setup-node))@([a-f0-9]{40})/g)];
  assert.equal(actions.length,3);assert.equal((yaml.match(/uses:/g)||[]).length,3);
  assert.ok(!/pull_request_target|secrets\.|id-token|aws-actions|terraform apply|docker compose/.test(yaml));
});

test('external tests have explicit tags, while the normal Test task keeps all tests',()=>{
  function javaFiles(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?javaFiles(join(dir,e.name)):e.name.endsWith('.java')?[join(dir,e.name)]:[]);}
  let integrations=0;
  for(const module of ['domain','application','event-contract','adapters','runtime'])for(const file of javaFiles(`backend/${module}/src/test/java`)){
    const source=readFileSync(file,'utf8');
    if(/@SpringBootTest|@Testcontainers/.test(source)){integrations++;assert.match(source,/@Tag\("integration"\)/,file);}
  }
  assert.ok(integrations>=16);
  const gradle=readFileSync('backend/build.gradle.kts','utf8');
  assert.match(gradle,/tasks\.register<Test>\("unitTest"\)/);assert.match(gradle,/excludeTags\("integration"\)/);
  assert.match(gradle,/tasks\.withType<Test>\(\)\.configureEach\s*\{\s*useJUnitPlatform\(\)\s*\}/);
});
