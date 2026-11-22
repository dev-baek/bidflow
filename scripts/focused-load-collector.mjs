import {mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {focusedConfig,planFocused,judgeFocused,judgeResources} from './focused-thousand.mjs';
import {isUuid} from './final-settlement.mjs';

export async function claimOutput(path) {
  if(typeof path!=='string'||/[:,\n\r]/.test(path))throw Error('invalid output path');
  const target=resolve(await realpath(dirname(resolve(path))),basename(resolve(path)));
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url))),rel=relative(root,target);
  if(rel===''||(!rel.startsWith('../')&&!isAbsolute(rel)))throw Error('output must be outside repository');
  await mkdir(target,{mode:0o700});
  return target;
}

export function parseReceipt(line,runId,mode) {
  if(typeof line!=='string'||line.length>2000)throw Error('invalid receipt');
  const r=JSON.parse(line),plan=planFocused(runId,mode,r?.vu,r?.iteration);
  if(Object.keys(plan).some(k=>r[k]!==plan[k]))throw Error('invalid plan');
  return {...plan,requestId:isUuid(r.requestId)?r.requestId:null,
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

export async function collectFocused(mode,io) {
  const {count}=focusedConfig(mode);
  const e={mode,valid:false,fullVerified:false,observationValid:false,startedAt:new Date().toISOString(),
    cpu:[],containers:[],lagSamples:[],receipts:[],consistency:{valid:false},resources:{valid:false}};
  let load,finished=false,abort=false,watchers=[];
  const sampleLag=async()=>{
    const startedMs=io.now(),rows=lagRows(await io.lag());
    e.lagSamples.push({startedMs,completedMs:io.now(),rows});return rows;
  };
  const cpu=async()=>{const s=await io.cpu();e.cpu.push({atMs:io.now(),cpu:s.cpu,pressure:s.pressure});
    const high=e.cpu.slice(-5);if(![1,2].includes(s.pressure)||(high.length===5&&high.every(x=>x.cpu>=90)))throw Error('resource pressure');};
  const containers=async()=>{const s=await io.containers();e.containers.push({atMs:io.now(),oom:s.oom,memoryBytes:s.memoryBytes});if(s.oom!==false)throw Error('OOM');};
  const watch=(sample,delay)=> (async()=>{try{while(!finished&&!abort){await sample();
    if(io.now()-e.loadStartedMs>130000)throw Error('load deadline');await io.wait(delay);}}
    catch{abort=true;e.error='RESOURCE_OR_OBSERVATION_FAILED';}})();
  try {
    e.runtime=await io.prepare();
    if((await sampleLag()).some(r=>r.lag!==0))throw Error('preexisting lag');
    e.dltBefore=dltRows(await io.dlt());
    e.fixture=await io.fixture();planFocused(e.fixture.runId,mode,1,0);
    if(!isUuid(e.fixture.auctionId)||!Number.isFinite(Date.parse(e.fixture.endsAt)))throw Error('invalid fixture');
    await containers();await cpu();
    e.loadStartedMs=io.now();load=await io.start(e.fixture,mode);
    const done=Promise.resolve(load.done).then(code=>{e.exitCode=code;finished=true;},()=>{e.error='LOAD_FAILED';finished=true;});
    watchers=[watch(cpu,1000),watch(containers,3000),watch(sampleLag,3000)];
    while(!finished&&!abort)await io.wait(100);
    e.loadEndedMs=io.now();
    if(abort)await load.stop();else await done;
    finished=true;await Promise.all(watchers);await containers();
    const receipts=await io.receipts(e.fixture,mode);e.receipts=receipts.records;e.invalidReceipts=receipts.invalid;
    const summary=await io.summary();e.http=Object.fromEntries(['count','iterations','received','p50','p95','p99','errorRate'].map(k=>[k,Number.isFinite(summary[k])?summary[k]:null]));
    const deadline=e.loadEndedMs+60000;
    do {
      e.snapshot=await io.snapshot(e.fixture.auctionId);
      e.consistency=judgeFocused({...e.fixture,mode,receipts:e.receipts,snapshot:e.snapshot});
      const rows=await sampleLag();
      if(rows.every(r=>r.lag===0)&&e.snapshot?.requestCount===count&&e.snapshot.rows?.length===count
        &&e.snapshot.rows.every(r=>['ACCEPTED','REJECTED'].includes(r.decision))) {
        e.recoveredMs=io.now();break;
      }
      if(io.now()>=deadline)break;
      await io.wait(1000);
    }while(io.now()<deadline);
    e.dltAfter=dltRows(await io.dlt());
    e.resources=judgeResources({startedMs:e.loadStartedMs,endedMs:e.loadEndedMs,samples:e.cpu,containers:e.containers});
    const timings=[e.http.p50,e.http.p95,e.http.p99];
    e.performancePassed=timings.every(n=>Number.isFinite(n)&&n>=0)&&e.http.p50<=e.http.p95&&e.http.p95<=e.http.p99
      &&e.http.p95<300&&Number.isFinite(e.http.errorRate)&&e.http.errorRate>=0&&e.http.errorRate<0.01;
    const counters=e.http.count===count&&e.http.iterations===count&&e.http.received===count;
    e.observationValid=!e.error&&[0,99].includes(e.exitCode)&&counters&&e.invalidReceipts===0&&e.resources.valid
      &&Number.isFinite(e.recoveredMs)&&e.recoveredMs<=deadline&&e.dltBefore.every((n,i)=>n===e.dltAfter[i]);
  }catch{e.error??='COLLECTION_FAILED';}
  finally {
    finished=true;
    try{if(load)await load.stop();}catch{e.error='LOAD_STOP_FAILED';}
    await Promise.all(watchers);
    // Save before restoration as well so a failed restore cannot erase the trial.
    try{await io.save(e);}catch{e.error='ARTIFACT_WRITE_FAILED';}
    try{e.restoration=await io.restore();}catch{e.restoration={verified:false};}
    e.valid=!e.error&&e.observationValid&&e.consistency.valid&&e.performancePassed===true&&e.restoration?.verified===true;
    e.fullVerified=mode==='full'&&e.valid;e.completedAt=new Date().toISOString();await io.save(e);
  }
  return e;
}
