import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFocusedSql,buildSettlementReadinessSql} from '../../scripts/concurrent-browser-sql.mjs';
test('readiness counts only scoped final requests with existing SQL bounds',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  const sql=buildSettlementReadinessSql(id);
  assert.match(sql,/BEGIN READ ONLY; SET LOCAL statement_timeout = 4000;/);
  assert.match(sql,/count\(\*\) FILTER \(WHERE status IN \('ACCEPTED','REJECTED'\)\)/);
  assert.match(sql,new RegExp(`FROM bid_request WHERE auction_id='${id}'`));
  assert.doesNotMatch(sql,/bid_ledger|outbox_event/);
  for(const bad of [id+'\n',"';DELETE FROM bid_request",null])assert.throws(()=>buildSettlementReadinessSql(bad));
});
test('focused SQL selects only a valid new auction in read-only transaction with request keys',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  const sql=buildFocusedSql(id);
  assert.match(sql,/BEGIN READ ONLY/);assert.match(sql,/statement_timeout = 4000/);
  assert.match(sql,/r.idempotency_key/);assert.match(sql,/l.requested_amount/);
  assert.match(sql,new RegExp(`WHERE a.auction_id='${id}'`));
  assert.doesNotMatch(sql,/r.bid_request_id IN/);
  assert.equal((sql.match(/FROM outbox_event/g)||[]).length,1,'load query must scope events once, not scan all Outbox for every request');
  for(const value of ['bad',"';DELETE FROM auction;--",null])assert.throws(()=>buildFocusedSql(value));
});
