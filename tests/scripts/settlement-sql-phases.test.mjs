import assert from 'node:assert/strict';
import test from 'node:test';
import {buildFocusedSql} from '../../scripts/concurrent-browser-sql.mjs';
import {phaseStatements,readPlan,verifySnapshot,failureCode,phaseRounds} from '../../scripts/settlement-sql-phases.mjs';
import {fixture} from '../../scripts/settlement-sql-phases-fixture.mjs';

test('measures the original read-only SELECT with a balanced nine-call schedule',()=>{
  const {auctionId}=fixture;
  const sql=phaseStatements(auctionId);
  assert.equal(sql.PLAIN,buildFocusedSql(auctionId));
  for(const mode of ['NONE','TEXT']){
    const prefix=`EXPLAIN (ANALYZE, BUFFERS, SERIALIZE ${mode}, FORMAT JSON)\n`;
    assert(sql[mode].includes(prefix));
    assert.equal(sql[mode].replace(prefix,''),sql.PLAIN);
  }
  assert.deepEqual(phaseRounds,[['PLAIN','NONE','TEXT'],['NONE','TEXT','PLAIN'],['TEXT','PLAIN','NONE']]);
  assert.throws(()=>phaseStatements('not-an-id'));
});

test('keeps server output conversion distinct and rejects missing/invalid measurements',()=>{
  const node={'Node Type':'Seq Scan','Relation Name':'outbox_event','Actual Rows':1000,'Actual Loops':1,'Shared Hit Blocks':128};
  const plan={'Plan':node,'Planning Time':1,'Execution Time':10};
  const serialization={'Time':2,'Output Volume':691,'Format':'text'};
  assert.throws(()=>readPlan([plan],'TEXT'),/SQL_OUTPUT_INVALID/);
  assert.throws(()=>readPlan([{...plan,Serialization:{...serialization,Time:null}}],'TEXT'),/SQL_OUTPUT_INVALID/);
  assert.throws(()=>readPlan([{...plan,Serialization:serialization}],'NONE'),/SQL_OUTPUT_INVALID/);
  assert.equal(readPlan([plan],'NONE').serialization,null);
  assert.deepEqual(readPlan([{...plan,Serialization:serialization}],'TEXT').serialization,{ms:2,kB:691});
});

test('allows row ordering changes but rejects duplicate, missing or altered settlement records',()=>{
  const {snapshot}=fixture;
  const hash=verifySnapshot(snapshot);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(verifySnapshot({...snapshot,rows:[...snapshot.rows].reverse()}),hash);
  assert.throws(()=>verifySnapshot({...snapshot,rows:snapshot.rows.slice(1)}),/SQL_OUTPUT_INVALID/);
  assert.throws(()=>verifySnapshot({...snapshot,rows:[snapshot.rows[1],...snapshot.rows.slice(1)]}),/SQL_OUTPUT_INVALID/);
  const wrong=structuredClone(snapshot);
  wrong.rows[1].events[0].reason='wrong';
  assert.throws(()=>verifySnapshot(wrong),/SQL_OUTPUT_INVALID/);
});

test('separates server cancellation, local deadline and invalid output without exposing stderr',()=>{
  assert.equal(failureCode({status:3,stderr:'ERROR:  57014:  canceling statement due to statement timeout\n'}),'SQL_QUERY_CANCELED');
  assert.equal(failureCode({error:{code:'ETIMEDOUT'},stderr:'ERROR:  57014: timeout'}),'SQL_PROCESS_TIMEOUT');
  assert.equal(failureCode({error:{code:'ENOBUFS'}}),'SQL_OUTPUT_INVALID');
  assert.equal(failureCode({status:1,stderr:'private detail'}),'SQL_CALL_FAILED');
  assert.equal(failureCode({status:0}),null);
});
