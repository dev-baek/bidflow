import {mkdir,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {focusedConfig,planFocused,judgeFocused,judgeResources} from './focused-thousand.mjs';
import {isUuid} from './final-settlement.mjs';
import {diagnosticCorrelationId} from './bid-ingress-observation.mjs';
import {snapshotFailureCodes} from './concurrent-browser-sql.mjs';
import {summarizeTrace,summarizePhases} from './command-trace.mjs';

export async function claimOutput(path) {
  if(typeof path!=='string'||/[:,\n\r]/.test(path))throw Error('invalid output path');
  const target=resolve(await realpath(dirname(resolve(path))),basename(resolve(path)));
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url))),rel=relative(root,target);
  if(rel===''||(!rel.startsWith('../')&&!isAbsolute(rel)))throw Error('output must be outside repository');
  for(let parent=dirname(target);;parent=dirname(parent)) {
    let git=false;
    try{await lstat(resolve(parent,'.git'));git=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(git)throw Error('output must be outside Git worktrees');
    if(parent===dirname(parent))break;
  }
  await mkdir(target,{mode:0o700});
  return target;
}

export function parseReceipt(line,runId,mode) {
  if(typeof line!=='string'||line.length>2000)throw Error('invalid receipt');
  const r=JSON.parse(line),plan=planFocused(runId,mode,r?.vu,r?.iteration);
  if(Object.keys(plan).some(k=>r[k]!==plan[k]))throw Error('invalid plan');
  return {...plan,requestId:isUuid(r.requestId)?r.requestId:null,
    correlationId:diagnosticCorrelationId(r.correlationId),
    httpStatus:Number.isInteger(r.httpStatus)&&r.httpStatus>=0&&r.httpStatus<600?r.httpStatus:0,
    receiptStatus:r.receiptStatus==='RECEIVED'?'RECEIVED':null,
    durationMs:Number.isFinite(r.durationMs)&&r.durationMs>=0?r.durationMs:null};
}

function lagRows(rows) {
  if(!Array.isArray(rows)||rows.length!==3)throw Error('invalid lag');
  const clean=rows.map(r=>({partition:r?.partition,currentOffset:r?.currentOffset,endOffset:r?.endOffset,lag:r?.lag})).sort((a,b)=>a.partition-b.partition);
  if(clean.some((r,i)=>r.partition!==i||Object.values(r).some(v=>!Number.isSafeInteger(v)||v<0)||r.currentOffset+r.lag!==r.endOffset))throw Error('invalid lag');
  return clean;
}
const dltRows=rows=>{
  if(!Array.isArray(rows)||rows.length!==3||rows.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('invalid DLT');
  return [...rows];
};

export async function collectFocused(mode,io,observer) {
  const {count}=focusedConfig(mode);
  const e={mode,valid:false,fullVerified:false,observationValid:false,startedAt:new Date().toISOString(),
    cpu:[],containers:[],lagSamples:[],readinessChecks:[],receipts:[],failures:[],consistency:{valid:false},resources:{valid:false},
    commandTrace:summarizeTrace(),phaseSummary:summarizePhases(),diagnosticsComplete:false};
  if(observer)e.browserObservationValid=false;
  let load,finished=false,abort=false,watchers=[],stage='prepare';
  const browserDeadline=observer?io.now()+300000:Infinity;
  const assertBrowserTime=()=>{if(observer&&io.now()>=browserDeadline)throw Error('browser run deadline');};
  const failure=(source,error)=>e.failures.push({source,kind:error?.killed===true?'TERMINATED':'FAILED',
    ...(source==='snapshot'&&snapshotFailureCodes.includes(error?.code)?{code:error.code}:{})});
  const diagnostics=()=>{
    try{e.commandTrace=summarizeTrace(io.trace?.());}catch{e.commandTrace=summarizeTrace();}
    e.diagnosticsComplete=e.commandTrace.complete&&e.phaseSummary.complete;
  };
  const sampleLag=async()=>{
    const startedMs=io.now(),rows=lagRows(await io.lag());
    e.lagSamples.push({startedMs,completedMs:io.now(),rows});return rows;
  };
  const cpu=async()=>{const s=await io.cpu();e.cpu.push({atMs:io.now(),cpu:s.cpu,pressure:s.pressure});
    const high=e.cpu.slice(-5);if(![1,2].includes(s.pressure)||(high.length===5&&high.every(x=>x.cpu>=90)))throw Error('resource pressure');};
  const containers=async()=>{const s=await io.containers();e.containers.push({atMs:io.now(),oom:s.oom,memoryBytes:s.memoryBytes});if(s.oom!==false)throw Error('OOM');};
  const watch=(sample,delay,source)=> (async()=>{try{while(!finished&&!abort){await sample();
    if(io.now()-e.loadStartedMs>130000)throw Error('load deadline');await io.wait(delay);}}
    catch(error){failure(source,error);abort=true;e.error='RESOURCE_OR_OBSERVATION_FAILED';}})();
  try {
    e.runtime=await io.prepare();
    if((await sampleLag()).some(r=>r.lag!==0))throw Error('preexisting lag');
    e.dltBefore=dltRows(await io.dlt());
    e.fixture=await io.fixture();planFocused(e.fixture.runId,mode,1,0);
    if(!isUuid(e.fixture.auctionId)||!Number.isFinite(Date.parse(e.fixture.endsAt)))throw Error('invalid fixture');
    stage='browser-prepare';
    if(observer)await observer.prepare(e.fixture,mode);
    await containers();await cpu();
    assertBrowserTime();
    if(observer?.error())throw Error('browser not ready');
    stage='load';
    e.loadStartedMs=io.now();load=await io.start(e.fixture,mode);
    const done=Promise.resolve(load.done).then(code=>{e.exitCode=code;finished=true;},()=>{e.error='LOAD_FAILED';finished=true;});
    watchers=[watch(cpu,1000,'cpu'),watch(containers,3000,'containers'),watch(sampleLag,3000,'lag')];
    while(!finished&&!abort){
      if(observer&&(observer.error()||io.now()>=browserDeadline)){abort=true;e.error='BROWSER_OBSERVATION_FAILED';break;}
      await io.wait(100);
    }
    e.loadEndedMs=io.now();
    if(abort)await load.stop();else await done;
    finished=true;await Promise.all(watchers);await containers();
    stage='receipts';const receipts=await io.receipts(e.fixture,mode);e.receipts=receipts.records;e.invalidReceipts=receipts.invalid;
    stage='summary';
    const summary=await io.summary();e.http=Object.fromEntries(['count','iterations','received','p50','p95','p99','errorRate'].map(k=>[k,Number.isFinite(summary[k])?summary[k]:null]));
    e.phaseSummary=summarizePhases(summary.phaseMetrics);
    const deadline=Math.min(e.loadEndedMs+60000,browserDeadline);
    const withinRecovery=(requiredMs=0)=>{
      if(io.now()+requiredMs>=deadline){
        e.error??='RECOVERY_DEADLINE';
        throw Error('recovery deadline');
      }
    };
    while(true){
      stage='recovery-lag';withinRecovery(12000);
      const rows=await sampleLag();
      withinRecovery();
      if(rows.every(r=>r.lag===0)){
        stage='readiness';withinRecovery(5000);
        const startedMs=io.now(),r=await io.readiness(e.fixture.auctionId),completedMs=io.now();
        if(r?.auctionId!==e.fixture.auctionId||!Number.isSafeInteger(r.requestCount)
          ||!Number.isSafeInteger(r.completedCount)||r.completedCount<0||r.completedCount>r.requestCount||r.requestCount>count){
          e.error??='RECOVERY_READINESS_INVALID';throw Error('invalid readiness counts');
        }
        e.readinessChecks.push({startedMs,completedMs,requestCount:r.requestCount,completedCount:r.completedCount});
        withinRecovery();
        if(r.completedCount===count)break;
      }
      stage='recovery-wait';withinRecovery(1000);
      await io.wait(1000);
    }
    stage='snapshot';withinRecovery(5000);
    e.snapshot=io.snapshotWithWaits?
      await io.snapshotWithWaits(e.fixture.auctionId,deadline,()=>withinRecovery(5000),value=>{e.settlementWait=value;}):
      await io.snapshot(e.fixture.auctionId);
    withinRecovery();
    e.consistency=judgeFocused({...e.fixture,mode,receipts:e.receipts,snapshot:e.snapshot});
    stage='post-snapshot-lag';withinRecovery(12000);
    const postSnapshotLag=await sampleLag();
    withinRecovery();
    if(e.consistency.valid&&postSnapshotLag.every(r=>r.lag===0))e.recoveredMs=io.now();
    stage='recovery-dlt';withinRecovery(12000);
    e.dltAfter=dltRows(await io.dlt());
    withinRecovery();
    e.resources=judgeResources({startedMs:e.loadStartedMs,endedMs:e.loadEndedMs,samples:e.cpu,containers:e.containers});
    const timings=[e.http.p50,e.http.p95,e.http.p99];
    e.performancePassed=timings.every(n=>Number.isFinite(n)&&n>=0)&&e.http.p50<=e.http.p95&&e.http.p95<=e.http.p99
      &&e.http.p95<300&&Number.isFinite(e.http.errorRate)&&e.http.errorRate>=0&&e.http.errorRate<0.01;
    const counters=e.http.count===count&&e.http.iterations===count&&e.http.received===count;
    e.observationValid=!e.error&&[0,99].includes(e.exitCode)&&counters&&e.invalidReceipts===0&&e.resources.valid
      &&Number.isFinite(e.recoveredMs)&&e.recoveredMs<=deadline&&e.dltBefore.every((n,i)=>n===e.dltAfter[i]);
    stage='browser-finish';
    assertBrowserTime();
    if(observer&&e.consistency.valid&&e.observationValid&&!observer.error()){
      e.browser=await observer.finish(e,deadline);
      assertBrowserTime();
    }
  }catch(error){failure(stage,error);e.error??='COLLECTION_FAILED';}
  finally {
    finished=true;
    if(observer){
      try{e.browserEvidence=observer.freeze(Math.min(browserDeadline,(e.loadEndedMs??Infinity)+60000));}
      catch{failure('browser-freeze');}
    }
    try{if(load)await load.stop();}catch{e.error='LOAD_STOP_FAILED';}
    await Promise.all(watchers);
    if(observer){
      try{
        await observer.close();
        e.browserObservationValid=e.browser?.valid===true&&e.browserEvidence?.error===null&&io.now()<browserDeadline;
      }catch{failure('browser-close');}
    }
    // Save before restoration as well so a failed restore cannot erase the trial.
    diagnostics();
    try{await io.save(e);}catch{e.error='ARTIFACT_WRITE_FAILED';}
    try{e.restoration=await io.restore();}catch{e.restoration={verified:false};}
    diagnostics();e.observationValid=e.observationValid&&e.diagnosticsComplete&&e.commandTrace.successful;
    e.valid=!e.error&&e.observationValid&&e.consistency.valid&&e.performancePassed===true&&e.restoration?.verified===true;
    if(observer)e.valid=e.valid&&e.browserObservationValid;
    e.fullVerified=mode==='full'&&e.valid;e.completedAt=new Date().toISOString();await io.save(e);
  }
  return e;
}
