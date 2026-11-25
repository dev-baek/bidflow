import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {claimOutput} from './focused-load-collector.mjs';
import {fixture,seedSql} from './settlement-sql-phases-fixture.mjs';
import {failureCode,phaseRounds,phaseStatements,readPlan,verifySnapshot} from './settlement-sql-phases.mjs';

const [target,...rest]=process.argv.slice(2);
if(!target||rest.length)throw Error('usage: node scripts/run-settlement-sql-phases.mjs NEW_EXTERNAL_DIRECTORY');
const output=await claimOutput(target);
const name='bidflow-sql-phases-'+randomUUID();
const label='io.bidflow.settlement-sql-phases='+name;
const data='/var/lib/postgresql/data';
const run=(args,input,timeout=10000)=>spawnSync('docker',args,{input,timeout,encoding:'utf8',maxBuffer:4_000_000});
const docker=(args,input,timeout)=>{
  const result=run(args,input,timeout);
  if(result.error||result.status!==0)throw Error('DOCKER_COMMAND_FAILED');
  return result.stdout.trim();
};
const save=(file,body)=>writeFile(join(output,file),body,{flag:'wx',mode:0o600});
const summary={status:'INCOMPLETE',startedAt:new Date().toISOString(),limits:{statementMs:4000,processMs:5000},cases:[]};
const serviceNames=['postgres','kafka','redis','object-storage','opensearch'].map(name=>'bidflow-local-'+name+'-1');
const services=()=>docker(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Health.Status}}',...serviceNames]);
let container, before, started=false, stage='preflight';
const psql=db=>['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const statements=phaseStatements(fixture.auctionId);

async function measure(db,mode,file){
  const start=performance.now(), result=run(psql(db),statements[mode],5000);
  const elapsedMs=performance.now()-start;
  const code=failureCode(result);
  if(code)throw Error(code);
  await save(file+'.json',result.stdout);
  let parsed;
  try{parsed=JSON.parse(result.stdout);}catch{throw Error('SQL_OUTPUT_INVALID');}
  const measurement=mode==='PLAIN'?{sha256:verifySnapshot(parsed)}:readPlan(parsed,mode);
  return {mode,elapsedMs,stdoutBytes:Buffer.byteLength(result.stdout),...measurement};
}

try{
  assert(!process.env.DOCKER_HOST);
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^unix:\//);
  const image=docker(['image','inspect','postgres:17.5-alpine','--format','{{.Id}}']);
  assert.match(image,/^sha256:[a-f0-9]{64}$/);
  before=services();
  assert(before.split('\n').length===5&&before.split('\n').every(line=>line.endsWith(' healthy')));
  stage='starting-container';
  started=true;
  container=docker(['run','-d','--rm','--pull=never','--network','none','--name',name,'--label',label,
    '--tmpfs',data+':rw,size=512m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],undefined,30000);
  assert.match(container,/^[a-f0-9]{64}$/);
  const [info]=JSON.parse(docker(['inspect',container]));
  assert(info.Id===container&&info.Name==='/'+name&&info.Image===image&&info.HostConfig.AutoRemove
    &&info.HostConfig.NetworkMode==='none'&&info.HostConfig.Tmpfs?.[data]&&!Object.keys(info.HostConfig.PortBindings??{}).length
    &&info.Mounts.every(m=>m.Type==='tmpfs'));
  summary.isolationVerified=true;
  stage='server-ready';
  let ready=false;
  for(let i=0;i<40&&!ready;i++){
    ready=run(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,1500).status===0;
    if(!ready)await delay(250);
  }
  assert(ready);
  summary.server=docker(psql('postgres'),'SHOW server_version;');
  assert.match(summary.server,/^17\.5\b/);
  const migrations=new URL('../backend/adapters/src/main/resources/db/migration/',import.meta.url);
  const files=(await readdir(migrations)).filter(name=>/^V\d+__.*\.sql$/.test(name)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
  assert(files.length>0);
  const schema=(await Promise.all(files.map(name=>readFile(new URL(name,migrations),'utf8')))).join('\n');
  for(const [db,background] of [['small',2000],['large',100000]]){
    stage=db+'-seed';
    docker(psql('postgres'),`CREATE DATABASE ${db};`);
    docker(psql(db),`BEGIN;\n${schema}\n${seedSql(background)}\nCOMMIT;\nVACUUM (ANALYZE);\n`,45000);
    const item={background,samples:[]};
    summary.cases.push(item);
    stage=db+'-gate';
    item.gate=await measure(db,'PLAIN',stage);
    for(const [round,modes] of phaseRounds.entries()){
      for(const mode of modes){
        stage=`${db}-${round+1}-${mode}`;
        item.samples.push({round:round+1,...await measure(db,mode,stage)});
      }
    }
    console.log(`${db}: 9/9 samples, fixture verified`);
  }
  summary.status='MEASURED';
}catch(error){
  const known=['SQL_PROCESS_TIMEOUT','SQL_QUERY_CANCELED','SQL_OUTPUT_INVALID','SQL_CALL_FAILED','DOCKER_COMMAND_FAILED'];
  summary.failure={stage,code:known.includes(error.message)?error.message:'EXPERIMENT_FAILED'};
}finally{
  try{
    const owned=()=>docker(['ps','-aq','--no-trunc','--filter','label='+label]);
    if(started){
      const id=owned();
      if(id){
        assert.match(id,/^[a-f0-9]{64}$/);
        assert(!container||container===id);
        docker(['rm','-f',id]);
      }
      assert.equal(owned(),'');
    }
    summary.cleanupVerified=true;
    summary.existingServicesUnchanged=!!before&&services()===before;
  }catch{summary.cleanupVerified=false;}
  summary.finishedAt=new Date().toISOString();
  await save('summary.json',JSON.stringify(summary,null,2)+'\n');
}
console.log(JSON.stringify({status:summary.status,failure:summary.failure,cleanupVerified:summary.cleanupVerified,
  existingServicesUnchanged:summary.existingServicesUnchanged}));
if(summary.status!=='MEASURED'||!summary.cleanupVerified||!summary.existingServicesUnchanged)process.exitCode=1;
