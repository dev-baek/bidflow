import {setTimeout as wait} from 'node:timers/promises';
import {isSettlementTag,SETTLEMENT_SQL_MARKER} from './concurrent-browser-sql.mjs';

const intervalMs=100, setupMs=1000, snapshotMs=5000, sampleLimit=50;
const observedWaits={Lock:'LOCK',IO:'IO',LWLock:'LWLOCK',BufferPin:'BUFFER_PIN',IPC:'IPC',Client:'CLIENT'};
const inactive=new Set(['idle','idle in transaction','idle in transaction (aborted)','fastpath function call']);

export function buildWaitSampleSql(tag) {
  if(!isSettlementTag(tag))throw Error('invalid settlement observation scope');
  return "SELECT json_build_object('tracking',current_setting('track_activities')='on','rows',COALESCE(json_agg(s),'[]'::json)) "+
    "FROM (SELECT pid,backend_start AS \"backendStart\",starts_with(query,'"+SETTLEMENT_SQL_MARKER+"') AS marked,"+
    "state,wait_event_type AS \"waitType\",wait_event AS event FROM pg_stat_activity "+
    "WHERE datname = 'bidflow' AND usename = 'bidflow' AND backend_type = 'client backend' "+
    "AND application_name = '"+tag+"' LIMIT 2) s;";
}

function decode(line) {
  if(typeof line!=='string'||line.length>4096)throw Error('invalid sample');
  const value=JSON.parse(line);
  if(value?.tracking!==true||!Array.isArray(value.rows)||value.rows.length>2)throw Error('unavailable sample');
  return value.rows;
}

function classify(row) {
  if(typeof row?.marked!=='boolean'||!(row.state==='active'||inactive.has(row.state))
    ||!(row.waitType===null&&row.event===null
      ||typeof row.waitType==='string'&&typeof row.event==='string'))throw Error('invalid wait fields');
  if(!row.marked)return 'OTHER_STATEMENT';
  if(row.state!=='active')return 'INACTIVE';
  if(row.waitType===null)return 'NO_WAIT_OBSERVED';
  if(row.waitType==='Client'&&row.event==='ClientWrite')return 'CLIENT_WRITE';
  return Object.hasOwn(observedWaits,row.waitType)?observedWaits[row.waitType]:'OTHER_WAIT';
}

// One line per turn: bound output before parsing and never pass server errors to evidence.
export function openWaitObserver(child) {
  let pending,buffer='',broken=false,closed=false;
  const fail=(message='observer closed')=>{
    broken=true;
    pending?.finish(Error(message));
  };
  const done=new Promise(resolve=>child.once('close',()=>{closed=true;fail();resolve(true);}));
  child.on('error',()=>fail());
  child.stdin.on('error',()=>fail());
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    if(broken)return;
    if(!pending||buffer.length+chunk.length>4096)return fail('invalid observer output');
    buffer+=chunk;
    const end=buffer.indexOf('\n');
    if(end<0)return;
    if(end!==buffer.length-1)return fail('invalid observer output');
    const line=buffer.slice(0,end);buffer='';
    pending.finish(null,line);
  });
  return {
    query:(sql,signal)=>new Promise((resolve,reject)=>{
      if(broken||pending||signal.aborted)return reject(Error('observer unavailable'));
      const abort=()=>fail('observer deadline');
      pending={finish:(error,line)=>{
        pending=undefined;
        signal.removeEventListener('abort',abort);
        if(error)reject(error);else resolve(line);
      }};
      signal.addEventListener('abort',abort,{once:true});
      child.stdin.write(sql+'\n');
    }),
    close:async(budgetMs=400)=>{
      child.stdin.end();
      if(closed)return true;
      const within=ms=>ms>0?Promise.race([done,wait(ms,false,{ref:false})]):false;
      const graceful=Math.min(200,Math.max(0,budgetMs-100));
      if(await within(graceful))return true;
      if(!closed)child.kill('SIGTERM');
      return closed||await within(Math.min(200,Math.max(0,budgetMs-graceful)));
    },
  };
}

export async function observeSettlementWait({now,deadline,tag,trace,checkBudget,open,snapshot,record,
  sleep=(ms,signal)=>wait(ms,undefined,{signal})}) {
  let observer,ready=false,binding,status='INSUFFICIENT_BUDGET',cancelReason=null,cleanupVerified=null,errors=0;
  const samples=[],stop=new AbortController();
  let poll=Promise.resolve(),window=null;
  try{
    if(now()+setupMs+snapshotMs<deadline){
      const preparationEnd=now()+setupMs;
      try{
        observer=open();
        const remaining=Math.ceil(preparationEnd-now());
        if(remaining<=0)throw Error('setup deadline');
        const prepared=decode(await observer.query('SET default_transaction_read_only=on; SET statement_timeout=200; '+
          buildWaitSampleSql(tag),AbortSignal.timeout(remaining)));
        if(now()>=preparationEnd)throw Error('setup deadline');
        status=prepared.length?'PREEXISTING_TARGET':'NO_ACTIVE_SAMPLES';
        ready=prepared.length===0;
      }catch{status='UNAVAILABLE';errors++;}
    }
    checkBudget();
    const commandBefore=trace()?.commandId??0;
    let completed=false;
    const run=(async()=>{
      try{return await snapshot(ready?tag:undefined);}
      catch(error){cancelReason=['STATEMENT_TIMEOUT','UNKNOWN'].includes(error?.cancelReason)?error.cancelReason:null;throw error;}
      finally{completed=true;stop.abort();}
    })();
    const commandStart=now();
    if(ready)poll=(async()=>{
      const until=Math.min(deadline,commandStart+snapshotMs);
      const signal=AbortSignal.any([stop.signal,AbortSignal.timeout(Math.max(1,Math.ceil(until-now())))]);
      while(!completed&&!signal.aborted&&samples.length<sampleLimit){
        try{
          let sentMs=now();
          const previous=samples.at(-1);
          if(!Number.isFinite(sentMs)||(previous&&sentMs<previous.receivedMs))throw Error('invalid sample clock');
          const next=previous?previous.sentMs+intervalMs:sentMs;
          while(sentMs<next&&!signal.aborted){
            await sleep(Math.ceil(next-sentMs),signal);
            const resumed=now();
            if(!Number.isFinite(resumed)||resumed<sentMs)throw Error('invalid sample clock');
            sentMs=resumed;
          }
          if(completed||signal.aborted||sentMs>=until)break;
          const matched=decode(await observer.query(buildWaitSampleSql(tag),signal)),receivedMs=now();
          if(!Number.isFinite(receivedMs)||receivedMs<sentMs)throw Error('invalid sample clock');
          if(matched.length>1){status='INVALID_TARGET';errors++;break;}
          const row=matched[0];
          if(row){
            if(!Number.isSafeInteger(row.pid)||row.pid<=0||typeof row.backendStart!=='string'
              ||!Number.isFinite(Date.parse(row.backendStart)))throw Error('invalid identity');
            if(binding&&(row.pid!==binding.pid||row.backendStart!==binding.backendStart)){
              status='INVALID_TARGET';errors++;break;
            }
            binding??={pid:row.pid,backendStart:row.backendStart};
          }
          samples.push({sentMs,receivedMs,category:row?classify(row):'NO_TARGET'});
        }catch{
          if(!stop.signal.aborted){status='OBSERVATION_FAILED';errors++;}
          break;
        }
      }
      if(!completed&&signal.aborted&&status==='NO_ACTIVE_SAMPLES'){status='OBSERVATION_FAILED';errors++;}
    })();
    try{return await run;}
    finally{
      await poll;
      const command=trace();
      const validWindow=command?.operation==='SCOPED_SQL'&&Number.isSafeInteger(command.commandId)&&command.commandId>commandBefore
        &&Number.isFinite(command.startedMs)&&Number.isFinite(command.completedMs)&&command.completedMs>=command.startedMs;
      if(validWindow)window={commandId:command.commandId,startedMs:command.startedMs,completedMs:command.completedMs};
    }
  }finally{
    if(observer){
      try{cleanupVerified=await observer.close(Math.max(0,deadline-now()))===true;}
      catch{cleanupVerified=false;}
    }
    const inWindow=window?samples.filter(s=>s.sentMs>=window.startedMs&&s.receivedMs>=s.sentMs
      &&s.receivedMs<=window.completedMs&&s.receivedMs<=deadline):[];
    const validSamples=inWindow.map(s=>({sentOffsetMs:s.sentMs-window.startedMs,
      receivedOffsetMs:s.receivedMs-window.startedMs,category:s.category}));
    const counts={};
    for(const s of validSamples)counts[s.category]=(counts[s.category]??0)+1;
    const gaps=new Set(['NO_TARGET','OTHER_STATEMENT','INACTIVE']);
    const activeSamples=validSamples.filter(s=>!gaps.has(s.category)).length;
    const maxGapMs=inWindow.length<2?null:Math.max(...inWindow.slice(1).map((s,i)=>s.receivedMs-inWindow[i].receivedMs));
    if(status==='NO_ACTIVE_SAMPLES')status=!window?'NO_COMMAND_WINDOW':activeSamples>0?'OBSERVED':status;
    record({status,
      command:window,samples:validSamples,counts,activeSamples,errors,maxGapMs,discarded:samples.length-validSamples.length,
      cleanupVerified,cancelReason});
  }
}
