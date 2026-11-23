import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readScopedSnapshot,buildFocusedSql,SETTLEMENT_SQL_MARKER} from '../../scripts/concurrent-browser-sql.mjs';
import {buildWaitSampleSql,openWaitObserver,observeSettlementWait} from '../../scripts/settlement-wait-observation.mjs';
import {parseFocusedArgs} from '../../scripts/run-focused-load.mjs';

const auction='00000000-0000-4000-8000-000000000001';
const tag='bidflow-settlement-'+'a'.repeat(32);
const row=(changes={})=>({pid:17,backendStart:'2026-11-24T01:00:00Z',marked:true,state:'active',
  waitType:'Lock',event:'relation',...changes});
const rows=(...matches)=>JSON.stringify({tracking:true,rows:matches});

test('opt-in is last and keeps default focused invocation unchanged',()=>{
  assert.deepEqual(parseFocusedArgs(['/tmp/probe']),{path:'/tmp/probe',mode:'full',web:undefined,waits:false});
  assert.deepEqual(parseFocusedArgs(['/tmp/probe','smoke','http://127.0.0.1:5173','--settlement-waits']),
    {path:'/tmp/probe',mode:'smoke',web:'http://127.0.0.1:5173',waits:true});
  for(const argv of [[],['/tmp/probe','--bad'],['/tmp/probe','--settlement-waits','full'],
    ['/tmp/probe','full','--bad'],['/tmp/probe','smoke','--settlement-waits','--settlement-waits']])
    assert.throws(()=>parseFocusedArgs(argv));
});

test('diagnostic SELECT is one command in the original read-only transaction',async()=>{
  let calls=0;
  const reason='ERROR:  57014: canceling statement due to statement timeout\nDETAIL: private';
  await assert.rejects(readScopedSnapshot(auction,async(name,program,args,timeout)=>{
    calls++;
    assert.deepEqual([name,program,timeout],['SCOPED_SQL','docker',5000]);
    assert.deepEqual(args.slice(0,4),['exec','-e','PGAPPNAME='+tag,'bidflow-local-postgres-1']);
    const commands=args.flatMap((a,i)=>a==='-c'?[args[i+1]]:[]);
    assert.equal(commands.length,3);
    assert.equal(commands[0],'BEGIN READ ONLY; SET LOCAL statement_timeout = 4000;');
    assert(commands[1].startsWith(SETTLEMENT_SQL_MARKER));
    assert.equal(commands[0]+'\n'+commands[1].slice(SETTLEMENT_SQL_MARKER.length)+' '+commands[2],buildFocusedSql(auction));
    throw Object.assign(Error('private'),{code:3,stderr:reason});
  },tag),e=>e.code==='SQL_QUERY_CANCELED'&&e.cancelReason==='STATEMENT_TIMEOUT'&&!e.stderr);
  assert.equal(calls,1);
  for(const [stderr,reason] of [['ERROR:  57014: canceling statement due to user request','UNKNOWN'],
    ['DETAIL: ERROR:  57014: canceling statement due to statement timeout',undefined]]){
    await assert.rejects(readScopedSnapshot(auction,async()=>{throw Object.assign(Error(),{code:1,stderr});},tag),
      e=>e.cancelReason===reason&&e.code===(reason?'SQL_QUERY_CANCELED':'SQL_CALL_FAILED'));
  }
  await assert.rejects(readScopedSnapshot(auction,()=>assert.fail(),tag+'\n'));
  const sql=buildWaitSampleSql(tag);
  assert.match(sql,/datname = 'bidflow'.*usename = 'bidflow'/s);
  assert.match(sql,/backend_type = 'client backend'/);
  assert.match(sql,/application_name = 'bidflow-settlement-a{32}'/);
  assert.match(sql,/starts_with\(query,/);
  assert.throws(()=>buildWaitSampleSql(tag+"';"));
});

function fake(replies=[],options={}){
  let time=10,calls=0,opened=0,closed=0,trace={commandId:1,operation:'SCOPED_SQL',startedMs:0,completedMs:2};
  let assigned,result,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const run=()=>observeSettlementWait({now:()=>time,deadline:options.deadline??10000,tag,trace:()=>trace,
    checkBudget:()=>{if(options.noBudget)throw Error('same recovery deadline');},
    open:()=>{
      opened++;
      return {query:async(sql)=>{
        assert.match(sql,/pg_stat_activity/);
        if(sql.startsWith('SET')){time+=options.setupDelay??0;return options.setup??rows();}
        const reply=replies.shift();
        if(reply===null){release();await Promise.resolve();time+=25;return rows();}
        if(reply===undefined){release();return rows();}
        if(!replies.length)setImmediate(release);
        time+=25;
        if(reply instanceof Error)throw reply;
        return reply;
      },close:async()=>{closed++;release();return !options.badCleanup;}};
    },
    sleep:async ms=>{time+=options.earlyTimer&&ms>1?ms-0.5:ms;},
    snapshot:async scope=>{
      assigned=scope;calls++;
      trace={commandId:2,operation:'SCOPED_SQL',startedMs:time,completedMs:null};
      if(!assigned||options.instant)release();
      await pending;
      trace.completedMs=time;
      if(options.snapshotError)throw options.snapshotError;
      return {unchanged:true};
    },record:value=>{result=value;},
  });
  return {run,release,get result(){return result;},get calls(){return calls;},get opened(){return opened;},
    get closed(){return closed;},get assigned(){return assigned;}};
}

test('counts only active marked responses inside the exact trace window',async()=>{
  const f=fake([rows(row({marked:false})),rows(row({state:'idle'})),rows(row()),rows(row({waitType:'IO',event:'DataFileRead'})),
    rows(row({waitType:'Client',event:'ClientWrite'})),rows(row({waitType:null,event:null})),null]);
  assert.deepEqual(await f.run(),{unchanged:true});
  assert.deepEqual([f.calls,f.opened,f.closed,f.assigned],[1,1,1,tag]);
  assert.equal(f.result.status,'OBSERVED');
  assert.deepEqual(f.result.counts,{OTHER_STATEMENT:1,INACTIVE:1,LOCK:1,IO:1,CLIENT_WRITE:1,NO_WAIT_OBSERVED:1});
  assert.equal(f.result.command.commandId,2);
  assert.equal(f.result.discarded,1);
  assert.doesNotMatch(JSON.stringify(f.result),/bidflow-settlement|backendStart|DataFileRead|relation|statement_timeout/);
});

test('duplicate sessions, replacement, missing tracking and startup deadline fail closed',async()=>{
  for(const [samples,options,status,used] of [
    [[rows(row(),row({pid:18}))],{},'INVALID_TARGET',tag],
    [[rows(row()),rows(row({backendStart:'2026-11-24T01:00:01Z'}))],{},'INVALID_TARGET',tag],
    [[],{setup:rows(row())},'PREEXISTING_TARGET',undefined],
    [[],{setup:JSON.stringify({tracking:false,rows:[]})},'UNAVAILABLE',undefined],
    [[],{setupDelay:1000},'UNAVAILABLE',undefined],
    [[],{deadline:6010},'INSUFFICIENT_BUDGET',undefined],
  ]){
    const f=fake(samples,options);assert.deepEqual(await f.run(),{unchanged:true});
    assert.equal(f.calls,1);assert.equal(f.result.status,status);assert.equal(f.assigned,used);
  }
});

test('preserves observer diagnostics on snapshot failure and does not pretend quick success means coverage',async()=>{
  const failure=Object.assign(Error('secret'),{cancelReason:'STATEMENT_TIMEOUT'});
  const f=fake([rows(row()),new Error('secret')],{snapshotError:failure,badCleanup:true});
  await assert.rejects(f.run(),e=>e===failure);
  assert.equal(f.result.status,'OBSERVATION_FAILED');
  assert.equal(f.result.cancelReason,'STATEMENT_TIMEOUT');
  assert.equal(f.result.cleanupVerified,false);
  assert.equal(f.calls,1);assert.equal(f.result.counts.LOCK,1);
  assert.doesNotMatch(JSON.stringify(f.result),/secret/);
  const quick=fake([],{instant:true});
  await quick.run();
  assert.equal(quick.result.status,'NO_ACTIVE_SAMPLES');
});

test('caps the sample count and keeps the 100 ms spacing',async()=>{
  const f=fake(Array.from({length:50},()=>rows(row())));
  await f.run();
  assert.equal(f.result.samples.length,50);
  assert.equal(f.result.counts.LOCK,50);
  assert.equal(f.result.maxGapMs,100);
  assert(f.result.samples.every((s,i)=>s.sentOffsetMs===i*100&&s.receivedOffsetMs===i*100+25));
});

test('checks the monotonic clock again when a timer wakes before the next slot',async()=>{
  const f=fake([rows(row()),rows(row()),null],{earlyTimer:true});
  await f.run();
  assert.equal(f.result.status,'OBSERVED');
  assert.equal(f.result.counts.LOCK,2);
  assert(f.result.samples[1].sentOffsetMs-f.result.samples[0].sentOffsetMs>=100);
});

test('closes the prepared observer if the original recovery budget no longer permits SQL',async()=>{
  const f=fake([],{noBudget:true});
  await assert.rejects(f.run(),/same recovery deadline/);
  assert.deepEqual([f.opened,f.closed,f.calls],[1,1,0]);
  assert.equal(f.result.status,'NO_COMMAND_WINDOW');
  assert.equal(f.result.command,null);
  assert.equal(f.result.cleanupVerified,true);
});

test('line reader handles single in-flight replies, refuses overflow and verifies child close',async()=>{
  const launch=code=>openWaitObserver(spawn(process.execPath,['-e',code],{stdio:['pipe','pipe','ignore']}));
  const observer=launch("process.stdin.once('data',()=>{process.stdout.write('par');setTimeout(()=>process.stdout.write('tial\\n'),5);});");
  try{assert.equal(await observer.query('SELECT 1;',AbortSignal.timeout(2000)),'partial');}
  finally{assert.equal(await observer.close(),true);}
  const flooded=launch("process.stdin.once('data',()=>process.stdout.write('x'.repeat(5000)));");
  try{await assert.rejects(flooded.query('SELECT 1;',AbortSignal.timeout(2000)),/observer output/);}
  finally{assert.equal(await flooded.close(),true);}
});
