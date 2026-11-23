import {execFile,spawn} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {focusedConfig,planFocused} from './focused-thousand.mjs';
import {isUuid} from './final-settlement.mjs';
import {readScopedSnapshot} from './concurrent-browser-sql.mjs';
import {claimOutput,collectFocused,parseReceipt} from './focused-load-collector.mjs';
import {createCommandTrace} from './command-trace.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const services=['postgres','kafka','redis','object-storage','opensearch'].map(s=>`bidflow-local-${s}-1`);
export function executeObserved(program,args,{timeoutMs,onTimeout}) {
  return new Promise((resolve,reject)=>{
    let timer,localDeadlineExceeded=false;
    const child=execFile(program,args,{cwd:root,maxBuffer:4_000_000},(error,stdout,stderr)=>{
      clearTimeout(timer);
      if(error||localDeadlineExceeded)reject(Object.assign(error??Error('process deadline'),{stderr,localDeadlineExceeded}));
      else resolve({stdout,stderr});
    });
    timer=setTimeout(()=>{
      if(child.exitCode===null&&child.signalCode===null) {
        try{if(child.kill('SIGTERM')){localDeadlineExceeded=true;onTimeout();}}catch(error){reject(error);}
      }
    },timeoutMs);
  });
}

export function memoryBytes(input) {
  const m=typeof input==='string'&&input.match(/^([0-9]+(?:\.[0-9]+)?)(B|KiB|MiB|GiB|TiB|kB|MB|GB) \/ /);
  if(!m)throw Error('invalid Docker memory');
  const unit={B:1,KiB:1024,MiB:1024**2,GiB:1024**3,TiB:1024**4,kB:1000,MB:1000**2,GB:1000**3};
  const bytes=Number(m[1])*unit[m[2]];if(!Number.isFinite(bytes)||bytes<=0)throw Error('invalid Docker memory');return bytes;
}

export function buildK6Args(source,output,fixture,mode) {
  planFocused(fixture.runId,mode,1,0);
  if(!isUuid(fixture.auctionId)||[source,output].some(p=>!isAbsolute(p)||/[:,\n\r]/.test(p)))throw Error('invalid load path');
  return ['run','--rm','--name',`bidflow-focused-${fixture.runId}`,'--user',`${process.getuid()}:${process.getgid()}`,
    '-v',`${source}:/work:ro`,'-v',`${output}:/results:rw`,'-w','/work','grafana/k6:0.54.0','run',
    '--quiet','--log-format','raw','--console-output','/results/receipts.jsonl',
    '-e','BIDFLOW_BASE_URL=http://host.docker.internal:8080','-e','BIDFLOW_LOAD_SCENARIO=focused-thousand',
    '-e',`BIDFLOW_RUN_ID=${fixture.runId}`,'-e',`BIDFLOW_AUCTION_ID=${fixture.auctionId}`,'-e',`BIDFLOW_FOCUSED_MODE=${mode}`,
    'tests/load/bid-request.js'];
}

export function focusedApiMode(command,java,jar) {
  if(!java)return null;
  const expected=[java,'-jar',jar,'--spring.profiles.active=local','--server.address=127.0.0.1',
    '--logging.level.com.bidflow.runtime.OutboxScheduler=INFO'].join(' ');
  if(command===expected)return 'DEFAULT';
  if(command===expected+' --bidflow.bid.ingress-timing=true')return 'INGRESS_TIMING';
  return null;
}

function realIo(output) {
  const trace=createCommandTrace({now:()=>performance.now(),execute:executeObserved});
  const command=async(program,args,timeout=5000,operation='SETUP_METADATA')=>
    (await trace.run(operation,program,args,timeout)).stdout.trim();
  let runtime,priorCommand,previousCpu=os.cpus(),started=false;
  const jar=root+'/backend/runtime/build/libs/runtime-0.0.1-SNAPSHOT.jar';
  const hash=async()=>createHash('sha256').update(await readFile(jar)).digest('hex');
  const apiState=async()=>{
    const pid=await command('lsof',['-t','-iTCP:8080','-sTCP:LISTEN']);
    if(!/^\d+$/.test(pid))throw Error('one local API required');
    return {pid:Number(pid),command:await command('ps',['-p',pid,'-o','command='])};
  };
  const sql=async query=>JSON.parse(await command('docker',['exec','bidflow-local-postgres-1','psql','-XqAt','-U','bidflow','-d','bidflow','-v','ON_ERROR_STOP=1','-c',query],5000,'SCOPED_SQL'));
  return {
    now:()=>performance.now(),wait,
    trace:()=>trace.snapshot(),
    save:async e=>{await writeFile(output+'/evidence.tmp',JSON.stringify(e,null,2)+'\n',{mode:0o600});await rename(output+'/evidence.tmp',output+'/evidence.json');},
    prepare:async()=>{
      if(process.platform!=='darwin'||process.versions.node.split('.')[0]!=='24')throw Error('Mac and Node 24 required');
      if(process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith('unix://'))throw Error('local Docker required');
      const endpoint=await command('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}']);
      if(!endpoint.startsWith('unix://'))throw Error('local Docker required');
      const state=await apiState();
      const java=process.env.JAVA_HOME?process.env.JAVA_HOME+'/bin/java':'';
      const apiMode=focusedApiMode(state.command,java,jar);
      if(!apiMode)throw Error('explicit local system-Clock API required; no automatic restart');
      const processEnv=await command('ps',['eww','-p',String(state.pid),'-o','command=']);
      if(/(?:^| )(?:(?:BIDFLOW_|SPRING_|SERVER_)[A-Z0-9_]*|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS)=/.test(processEnv))throw Error('API environment override not allowed');
      priorCommand=state.command;
      const version=await command(java,['--version']);if(!version.startsWith('openjdk 21.'))throw Error('Java 21 required');
      const config=await command('unzip',['-p',jar,'BOOT-INF/classes/application-local.yml']);
      if(!/^\s+fixed-delay-ms: 100\s*$/m.test(config))throw Error('100ms local jar required');
      const ready=await fetch('http://127.0.0.1:8080/actuator/health/readiness',{redirect:'error',signal:AbortSignal.timeout(3000)});
      if(ready.status!==200||(await ready.json()).status!=='UP')throw Error('API not ready');
      const healthy=await command('docker',['inspect','--format','{{.State.Health.Status}} {{index .Config.Labels "com.docker.compose.project"}}',...services]);
      if(healthy.split('\n').length!==services.length||healthy.split('\n').some(s=>s!=='healthy bidflow-local'))throw Error('local services not healthy');
      runtime={pid:state.pid,jarSha256:await hash(),profile:'local',clock:'system',delayMs:100,logging:'INFO',apiMode,
        commit:await command('git',['rev-parse','HEAD']),node:process.version,java:version.split('\n')[0],
        docker:await command('docker',['info','--format','{{.ServerVersion}} {{.NCPU}} {{.MemTotal}}']),
        k6:await command('docker',['run','--rm','grafana/k6:0.54.0','version']),
        host:{model:await command('sysctl',['-n','hw.model']),arch:os.arch(),cpus:os.cpus().length,memoryBytes:os.totalmem(),os:os.release()}};
      previousCpu=os.cpus();return runtime;
    },
    restore:async()=>{
      if(!runtime)return {verified:!started,apiChanged:false};
      const state=await apiState();
      const ready=await fetch('http://127.0.0.1:8080/actuator/health/readiness',{redirect:'error',signal:AbortSignal.timeout(3000)});
      return {verified:state.pid===runtime.pid&&state.command===priorCommand&&await hash()===runtime.jarSha256
        &&ready.status===200&&(await ready.json()).status==='UP',apiChanged:false,pid:state.pid};
    },
    fixture:async()=>{
      const auctionId=randomUUID(),productId=randomUUID(),runId='focus'+randomUUID().replaceAll('-','');
      planFocused(runId,'full',1,0);
      const result=await sql(`BEGIN; SET LOCAL statement_timeout=4000;
        INSERT INTO product(product_id,seller_id,title,description,category_id,condition_grade,status,version,created_at,updated_at)
        VALUES('${productId}','${runId}-seller','${runId}','Local focused load fixture','DIGITAL','GOOD','PUBLISHED',1,now(),now());
        INSERT INTO auction(auction_id,product_id,seller_id,status,starting_price,current_price,starts_at,ends_at,version,created_at,updated_at)
        VALUES('${auctionId}','${productId}','${runId}-seller','ACTIVE',10000,10000,now()-interval '1 minute',now()+interval '31 minutes',1,now(),now());
        SELECT json_build_object('endsAt',ends_at) FROM auction WHERE auction_id='${auctionId}'; COMMIT;`);
      return {auctionId,productId,runId,endsAt:result.endsAt};
    },
    lag:async()=>{
      const text=await command('docker',['exec','bidflow-local-kafka-1','/opt/kafka/bin/kafka-consumer-groups.sh',
        '--bootstrap-server','localhost:9092','--describe','--group','bid-settlement'],12000,'KAFKA_LAG');
      return text.split('\n').map(s=>s.trim().split(/\s+/)).filter(c=>c[0]==='bid-settlement'&&c[1]==='bid-command')
        .map(c=>({partition:+c[2],currentOffset:+c[3],endOffset:+c[4],lag:+c[5]}));
    },
    dlt:async()=>{
      const text=await command('docker',['exec','bidflow-local-kafka-1','/opt/kafka/bin/kafka-get-offsets.sh',
        '--bootstrap-server','localhost:9092','--topic','bid-command.DLT','--time','-1'],12000,'KAFKA_DLT');
      const rows=text.split('\n').map(s=>s.trim().split(':')).sort((a,b)=>+a[1]-+b[1]);
      if(rows.length!==3||rows.some((r,i)=>r[0]!=='bid-command.DLT'||+r[1]!==i||!/^\d+$/.test(r[2])))throw Error('DLT offsets unavailable');
      return rows.map(r=>+r[2]);
    },
    cpu:async()=>{
      const next=os.cpus();let idle=0,total=0;
      if(next.length!==previousCpu.length)throw Error('CPU topology changed');
      next.forEach((c,i)=>{for(const [k,v]of Object.entries(c.times)){const delta=v-previousCpu[i].times[k];total+=delta;if(k==='idle')idle+=delta;}});
      previousCpu=next;
      const pressure=Number(await command('sysctl',['-n','kern.memorystatus_vm_pressure_level'],5000,'CPU_PRESSURE'));
      return {cpu:total>0?100*(1-idle/total):0,pressure};
    },
    containers:async()=>{
      const usage=(await command('docker',['stats','--no-stream','--format','{{.MemUsage}}',...services],5000,'CONTAINER_STATS')).split('\n');
      const oom=(await command('docker',['inspect','--format','{{.State.OOMKilled}}',...services],5000,'CONTAINER_OOM')).split('\n');
      if(usage.length!==services.length||oom.length!==services.length||oom.some(s=>!['true','false'].includes(s)))throw Error('incomplete container observation');
      return {memoryBytes:usage.reduce((sum,s)=>sum+memoryBytes(s),0),oom:oom.some(s=>s==='true')};
    },
    start:async(fixture,mode)=>{
      started=true;
      const child=spawn('docker',buildK6Args(root,output,fixture,mode),{cwd:root,stdio:'ignore'});
      const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      return {done,stop:async()=>{
        if(child.exitCode!==null||child.signalCode!==null)return;
        await command('docker',['stop','--time','5',`bidflow-focused-${fixture.runId}`],10000,'LOAD_STOP');
        await Promise.race([done,wait(5000).then(()=>{throw Error('load stop timeout');})]);
      }};
    },
    receipts:async(fixture,mode)=>{
      const records=[];let invalid=0;
      for(const line of (await readFile(output+'/receipts.jsonl','utf8')).split('\n').filter(Boolean)){
        try{records.push(parseReceipt(line,fixture.runId,mode));}catch{invalid++;}
      }
      return {records,invalid};
    },
    snapshot:auctionId=>readScopedSnapshot(auctionId,trace.run),
    summary:async()=>{
      const s=JSON.parse(await readFile(output+'/summary.json','utf8')).metrics;
      const timing=s['http_req_duration{operation:bid_request}'].values;
      return {count:s.http_reqs.values.count,iterations:s.iterations.values.count,received:s.bid_request_received?.values.count??0,
        p50:timing.med,p95:timing['p(95)'],p99:timing['p(99)'],errorRate:s['http_req_failed{operation:bid_request}'].values.rate,
        phaseMetrics:s};
    },
  };
}

async function main() {
  if(process.argv.length<3||process.argv.length>5)throw Error('usage: node scripts/run-focused-load.mjs NEW_EXTERNAL_DIRECTORY [smoke|full] [LOOPBACK_VITE_ORIGIN]');
  const mode=process.argv[3]??'full';focusedConfig(mode);
  const web=process.argv[4];
  const observer=web===undefined?undefined:(await import('../apps/web/e2e/load-browser-observer.mjs')).createBrowserObserver(web,()=>performance.now());
  const output=await claimOutput(process.argv[2]);
  const e=await collectFocused(mode,realIo(output),observer);
  console.log(JSON.stringify({mode,valid:e.valid,fullVerified:e.fullVerified,output}));
  if(!e.valid)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  console.error('Focused load failed. Check the new output directory and local API contract. No automatic retry.');process.exitCode=1;
});
