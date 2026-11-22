import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('strict integration uses real Gradle results and rejects skip, empty, missing, filtered and stale execution', {timeout:600000}, async t=>{
  const root=mkdtempSync(join(tmpdir(),'bidflow-strict-gradle.'));
  const modules=['domain','application','event-contract','adapters','runtime'];
  writeFileSync(join(root,'settings.gradle'),`rootProject.name='strict-fixture'\ninclude ${modules.map(m=>`'${m}'`).join(',')}`);
  const guard='backend/gradle/strict-integration.gradle';
  writeFileSync(join(root,'guard.gradle'),existsSync(guard)?readFileSync(guard):'');
  writeFileSync(join(root,'build.gradle'),`plugins { id 'base' }
subprojects {
  apply plugin: 'java'
  repositories { mavenCentral() }
  dependencies { testImplementation 'org.junit.jupiter:junit-jupiter:5.12.2'; testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.12.2' }
  tasks.withType(Test).configureEach { useJUnitPlatform() }
  tasks.register('unitTest',Test) { testClassesDirs=sourceSets.test.output.classesDirs; classpath=sourceSets.test.runtimeClasspath; useJUnitPlatform { excludeTags 'integration' } }
}
apply from: 'guard.gradle'
def mode=providers.gradleProperty('scenario').orElse('normal').get()
project(':adapters').tasks.named('test') {
  if(mode=='missing') enabled=false
  if(mode=='no-source') testClassesDirs=files()
  if(mode=='only-if') onlyIf { false }
  if(mode=='tag-filter') useJUnitPlatform { excludeTags 'integration' }
  if(mode=='pattern-filter') include '**/FixtureTest.class'
  if(mode=='ignore-failures') ignoreFailures=true
}
`);
  function sources(mode){for(const m of modules){const dir=join(root,m,'src/test/java');mkdirSync(dir,{recursive:true});
    const body=m==='adapters'&&mode==='empty'?'':`
    @org.junit.jupiter.api.Test void passes() { org.junit.jupiter.api.Assertions.assertTrue(true); }
    ${m==='adapters'&&mode==='disabled'?'@org.junit.jupiter.api.Disabled':''}
    @org.junit.jupiter.api.Tag("integration") @org.junit.jupiter.api.Test void boundary() {
      ${m==='adapters'&&mode==='abort'?'org.junit.jupiter.api.Assumptions.assumeTrue(false);':m==='adapters'&&mode==='failure'?'org.junit.jupiter.api.Assertions.fail("fixture failure");':''}
    }`;
    writeFileSync(join(dir,'FixtureTest.java'),`class FixtureTest {${body}}`);}}
  function run(mode='normal',flags=['-Pbidflow.strictIntegration=true'],target='check'){
    sources(mode);
    const r=spawnSync(resolve('backend/gradlew'),['-p',root,target,'--console=plain',`-Pscenario=${mode}`,...flags],{encoding:'utf8',timeout:120000,maxBuffer:2000000});
    assert.ifError(r.error);return {...r,output:r.stdout+r.stderr};
  }
  await t.test('Disabled tests must not produce strict success',()=>{const r=run('disabled');assert.notEqual(r.status,0,r.output);assert.match(r.output,/STRICT_INTEGRATION/);});
  await t.test('normal and repeated cached inputs execute all modules freshly',()=>{
    for(let i=0;i<2;i++){const r=run('normal',['-Pbidflow.strictIntegration=true','--build-cache']);assert.equal(r.status,0,r.output);assert.match(r.output,/STRICT_INTEGRATION_COMPLETE/);assert.equal((r.output.match(/STRICT_INTEGRATION_RESULT/g)||[]).length,5);assert.doesNotMatch(r.output,/:test (?:UP-TO-DATE|FROM-CACHE)/);}
  });
  for(const mode of ['abort','failure','empty','missing','no-source','only-if','tag-filter','pattern-filter','ignore-failures'])await t.test(mode+' cannot pass strict check',()=>{const r=run(mode);assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/STRICT_INTEGRATION_COMPLETE/);});
  await t.test('command line filtering and excluded task cannot pass',()=>{
    const filtered=run('normal',['--tests','FixtureTest','check','-Pbidflow.strictIntegration=true'],':adapters:test');
    assert.notEqual(filtered.status,0,filtered.output);assert.match(filtered.output,/STRICT_INTEGRATION_RESTRICTED/);
    const excluded=run('normal',['-Pbidflow.strictIntegration=true','-x',':adapters:test']);
    assert.notEqual(excluded.status,0,excluded.output);assert.match(excluded.output,/STRICT_INTEGRATION_MISSING/);
  });
  await t.test('bad property and direct partial execution are rejected',()=>{
    for(const [flags,target] of [[['-Pbidflow.strictIntegration=tru'],'check'],[['-Pbidflow.strictIntegration=true'],':adapters:test']]){const r=run('normal',flags,target);assert.notEqual(r.status,0,r.output);assert.match(r.output,/STRICT_INTEGRATION/);}
  });
  await t.test('absent and false preserve ordinary skip behavior; unit tests remain independent',()=>{
    for(const flags of [[],['-Pbidflow.strictIntegration=false']]){const r=run('disabled',flags);assert.equal(r.status,0,r.output);assert.doesNotMatch(r.output,/STRICT_INTEGRATION_COMPLETE/);}
    const r=run('disabled',[],'unitTest');assert.equal(r.status,0,r.output);
  });
});
