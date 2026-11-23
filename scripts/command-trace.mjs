const operations=['CONTAINER_STATS','CONTAINER_OOM','KAFKA_LAG','KAFKA_DLT','SCOPED_SQL','SETTLEMENT_READINESS','SETUP_METADATA','CPU_PRESSURE','LOAD_STOP'];
const outcomes=['SUCCEEDED','FAILED','TERMINATED','TIMED_OUT','OUTPUT_LIMIT'];
const signals=['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGHUP'];
const numeric=n=>Number.isFinite(n)&&n>=0;

export function summarizeTrace(input) {
  const raw=Array.isArray(input?.records)?input.records:[];
  const fields=['commandId','operation','startedMs','completedMs','durationMs','timeoutMs','outcome','exitCode','signal'];
  const limited=raw.slice(0,512);
  const original=limited.map(r=>Object.fromEntries(fields.map(k=>[k,r?.[k]??null])));
  const truncated=input?.truncated===true||raw.length>512;
  const complete=!truncated&&input?.clockValid===true&&original.length>0
    &&limited.every(r=>r&&fields.every(k=>Object.hasOwn(r,k)&&r[k]!==undefined))&&original.every((r,i)=>
    r.commandId===i+1&&operations.includes(r.operation)&&numeric(r.startedMs)&&numeric(r.completedMs)
    &&r.completedMs>=r.startedMs&&numeric(r.durationMs)&&Math.abs(r.durationMs-(r.completedMs-r.startedMs))<1e-6
    &&numeric(r.timeoutMs)&&r.timeoutMs>0&&outcomes.includes(r.outcome)
    &&(r.exitCode===null||(Number.isInteger(r.exitCode)&&r.exitCode>=0&&r.exitCode<=255))
    &&(r.signal===null||signals.includes(r.signal))
    &&(r.outcome!=='SUCCEEDED'||(r.exitCode===0&&r.signal===null))
    &&(!i||r.startedMs>=original[i-1].startedMs));
  const records=original.map(r=>({
    commandId:Number.isSafeInteger(r.commandId)&&r.commandId>0?r.commandId:null,
    operation:operations.includes(r.operation)?r.operation:null,
    startedMs:numeric(r.startedMs)?r.startedMs:null,completedMs:numeric(r.completedMs)?r.completedMs:null,
    durationMs:numeric(r.durationMs)?r.durationMs:null,timeoutMs:numeric(r.timeoutMs)?r.timeoutMs:null,
    outcome:[...outcomes,'PENDING'].includes(r.outcome)?r.outcome:null,
    exitCode:Number.isInteger(r.exitCode)&&r.exitCode>=0&&r.exitCode<=255?r.exitCode:null,
    signal:signals.includes(r.signal)?r.signal:null,
  }));
  return {records,truncated,clockValid:input?.clockValid===true,complete,
    successful:complete&&records.every(r=>r.outcome==='SUCCEEDED')};
}

export function createCommandTrace({now,execute}) {
  const records=[];let truncated=false,clockValid=true,last=-Infinity;
  const time=()=>{try{const n=now();if(!numeric(n)||n<last){clockValid=false;return numeric(n)?n:null;}last=n;return n;}
    catch{clockValid=false;return null;}};
  return {
    snapshot:()=>summarizeTrace({records,truncated,clockValid}),
    run:async(operation,program,args,timeoutMs=5000)=>{
      if(!operations.includes(operation)||!numeric(timeoutMs)||timeoutMs<=0)throw Error('invalid command observation');
      const record={commandId:records.length+1,operation,startedMs:time(),completedMs:null,durationMs:null,
        timeoutMs,outcome:'PENDING',exitCode:null,signal:null};
      if(records.length<512)records.push(record);else truncated=true;
      let timedOut=false;
      try {
        const result=await execute(program,args,{timeoutMs,onTimeout:()=>{timedOut=true;}});
        record.outcome=timedOut?'TIMED_OUT':'SUCCEEDED';record.exitCode=0;return result;
      }catch(error){
        record.outcome=error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'OUTPUT_LIMIT'
          :timedOut?'TIMED_OUT':error?.killed===true||signals.includes(error?.signal)?'TERMINATED':'FAILED';
        record.exitCode=Number.isInteger(error?.code)&&error.code>=0&&error.code<=255?error.code:null;
        record.signal=signals.includes(error?.signal)?error.signal:null;
        throw error;
      }finally {
        record.completedMs=time();
        record.durationMs=numeric(record.startedMs)&&numeric(record.completedMs)&&record.completedMs>=record.startedMs
          ?record.completedMs-record.startedMs:null;
      }
    },
  };
}

export function summarizePhases(metrics) {
  const phases={};let complete=true;
  for(const name of ['blocked','connecting','sending','waiting','receiving']) {
    const v=metrics?.['http_req_'+name]?.values;
    const row={p50:v?.med,p95:v?.['p(95)'],p99:v?.['p(99)']};
    for(const key of Object.keys(row))if(!numeric(row[key])){row[key]=null;complete=false;}
    if(row.p50>row.p95||row.p95>row.p99)complete=false;
    phases[name]=row;
  }
  return {complete,phases};
}
