import test from 'node:test';
import assert from 'node:assert/strict';
import { collectConcurrentRound } from '../../scripts/collect-concurrent-browser.mjs';
import { buildConcurrentSql, readConcurrentSql, judgeConcurrentSql } from '../../scripts/concurrent-browser-sql.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const auctionId = id(100);
const actors = { A: 'concurrent-a-test', B: 'concurrent-b-test' };
const endsAt = '2030-01-01T12:30:00Z';
function fake({ rejected = false, fail = false, hang = false, late = false } = {}) {
  let clock = 0, receive, detached = 0, submitted = [];
  const io = { index: 0, auctionId, now: () => clock,
    subscribe(callback) { receive = callback; return () => { detached++; }; },
    async submit(bidder, { onStart, onPost, signal }) {
      assert.ok(receive); assert.equal(signal.aborted, false); submitted.push(bidder);
      onStart(); onPost();
      // Both commands are in flight before either result; frames precede HTTP completion.
      await Promise.resolve();
      if (hang) return new Promise(() => {});
      if (fail && bidder === 'A') throw Error('secret-token');
      clock = bidder === 'A' ? 10 : 20;
      receive(bidder, { type: 'bid.result', bidRequestId: id(bidder === 'A' ? 1 : 2), auctionId,
        decision: rejected && bidder === 'A' ? 'REJECTED' : 'ACCEPTED',
        reason: rejected && bidder === 'A' ? 'BID_TOO_LOW' : null,
        currentPrice: bidder === 'A' && !rejected ? 11000 : 12000,
        auctionVersion: bidder === 'A' || rejected ? 2 : 3,
        isHighestBidder: !(rejected && bidder === 'A'), secret: 'secret-token' });
      return { httpStatus: 202, receiptStatus: 'RECEIVED', requestId: id(bidder === 'A' ? 1 : 2), token: 'secret-token' };
    },
    async observeScreen() {
      clock = late ? 10000 : 30;
      return { prices: [12000, 12000], decisions: [{ bidder: 'A', decision: rejected ? 'REJECTED' : 'ACCEPTED' },
        { bidder: 'B', decision: 'ACCEPTED' }], token: 'secret-token' };
    },
  };
  return { io, get detached() { return detached; }, submitted,
    lateFrame() { receive('A', { bidRequestId: id(1), secret: 'secret-token' }); } };
}
function snapshot(input) {
  return { auction: { auctionId, status: 'ACTIVE', currentPrice: 12000, winnerId: actors.B,
    version: input.frames.some(f => f.result.decision === 'REJECTED') ? 2 : 3, endsAt },
    requestCount: 2, ledgerCount: 2, resultCount: 2,
    rows: input.receipts.map(r => {
      const result = input.frames.find(f => f.result.bidRequestId === r.requestId).result;
      const rejected = result.decision === 'REJECTED';
      return { requestId: r.requestId, auctionId, bidderId: actors[r.bidder], amount: r.amount, decision: result.decision,
        ledgers: [{ id: id(r.bidder === 'A' ? 11 : 12), bidderId: actors[r.bidder], amount: r.amount,
          decision: result.decision, price: rejected ? null : r.amount, reason: rejected ? 'BID_TOO_LOW' : null }],
        events: [{ id: id(r.bidder === 'A' ? 21 : 22), requestId: r.requestId, auctionId, bidderId: actors[r.bidder],
          type: rejected ? 'BidRejected' : 'BidAccepted', version: result.auctionVersion,
          price: rejected ? null : r.amount, reason: rejected ? 'BID_TOO_LOW' : null }] };
    }) };
}

test('collects both submissions after listener registration and correlates early frames without retaining secrets', async () => {
  for (const rejected of [false, true]) {
    const f = fake({ rejected }); const result = await collectConcurrentRound(f.io);
    assert.equal(result.error, null); assert.equal(result.verdict.valid, true);
    assert.deepEqual(f.submitted, ['A', 'B']); assert.equal(f.detached, 1);
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
    const before = JSON.stringify(result); f.lateFrame(); assert.equal(JSON.stringify(result), before);
    const sql = judgeConcurrentSql(result.input, snapshot(result.input), actors, endsAt);
    assert.equal(sql.valid, true); assert.equal(sql.accepted, rejected ? 1 : 2);
  }
});

test('HTTP failure, hanging I/O and late screen preserve partial evidence, abort and detach without success', async () => {
  for (const options of [{ fail: true }, { hang: true }, { late: true }]) {
    const f = fake(options); let signal;
    const submit = f.io.submit;
    f.io.submit = (bidder, context) => { signal = context.signal; return submit(bidder, context); };
    const result = await collectConcurrentRound({ ...f.io, timeoutMs: 20 });
    assert.equal(result.verdict.valid, false); assert.ok(result.error);
    assert.equal(signal.aborted, true); assert.equal(f.detached, 1);
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
    assert.equal(result.input.receipts.length, 2);
  }
});

test('invalid round configuration fails before subscriptions or submissions', async () => {
  for (const patch of [{ auctionId: 'bad' }, { index: 10 }, { timeoutMs: 0 }, { timeoutMs: 10001 }]) {
    const f = fake(); await assert.rejects(collectConcurrentRound({ ...f.io, ...patch }));
    assert.equal(f.detached, 0); assert.equal(f.submitted.length, 0);
  }
});

test('late HTTP completion cannot mutate returned evidence, and duplicate POST or cleanup failure cannot pass', async () => {
  const f = fake(); const releases = [];
  f.io.submit = (bidder, { onStart, onPost }) => {
    onStart(); onPost(); return new Promise(resolve => { releases.push(() => resolve({ httpStatus: 202, receiptStatus: 'RECEIVED', requestId: id(1) })); });
  };
  const timed = await collectConcurrentRound({ ...f.io, timeoutMs: 20 });
  const before = JSON.stringify(timed); releases.forEach(release => release()); await Promise.resolve(); await Promise.resolve();
  assert.equal(JSON.stringify(timed), before);
  for (const cleanupFailure of [false, true]) {
    const g = fake();
    if (cleanupFailure) { const sub = g.io.subscribe; g.io.subscribe = callback => { const detach = sub(callback);
      return () => { detach(); throw Error('secret-token'); }; }; }
    else { const submit = g.io.submit; g.io.submit = (bidder, context) => submit(bidder, { ...context,
      onPost() { context.onPost(); context.onPost(); } }); }
    const result = await collectConcurrentRound(g.io);
    assert.equal(result.verdict.valid, false); assert.ok(result.error); assert.equal(g.detached, 1);
  }
});

test('subscription/screen failures, missing POST and malformed HTTP receipt remain sanitized failures', async () => {
  for (const mode of ['subscribe', 'screen', 'post', 'receipt']) {
    const f = fake();
    if (mode === 'subscribe') f.io.subscribe = () => { throw Error('secret-token'); };
    if (mode === 'screen') f.io.observeScreen = () => { throw Error('secret-token'); };
    if (mode === 'post' || mode === 'receipt') {
      const submit = f.io.submit;
      f.io.submit = async (bidder, context) => {
        const response = await submit(bidder, mode === 'post' ? { ...context, onPost() {} } : context);
        return mode === 'receipt' ? { httpStatus: 500, receiptStatus: 'secret-token', requestId: 'secret-token' } : response;
      };
    }
    const result = await collectConcurrentRound(f.io);
    assert.equal(result.verdict.valid, false); assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
    assert.equal(f.detached, mode === 'subscribe' ? 0 : 1);
  }
});

test('SQL verdict checks every request/ledger/event and the final auction, never only row counts', async () => {
  const { input } = await collectConcurrentRound(fake().io);
  const good = snapshot(input);
  const edits = [
    s => { s.requestCount = 3; }, s => { s.resultCount = 1; }, s => { s.rows.pop(); },
    s => { s.rows[0].ledgers.push(s.rows[0].ledgers[0]); }, s => { s.rows[0].events = []; },
    s => { s.rows[0].decision = 'REJECTED'; }, s => { s.rows[0].bidderId = actors.B; },
    s => { s.rows[0].ledgers[0].price = 12000; }, s => { s.rows[0].events[0].auctionId = id(999); },
    s => { s.rows[0].events[0].version = 3; }, s => { s.rows[0].events[0].requestId = id(999); },
    s => { s.rows[1].events[0].id = s.rows[0].events[0].id; },
    s => { s.auction.version = 2; }, s => { s.auction.winnerId = actors.A; },
    s => { s.auction.currentPrice = 11000; }, s => { s.auction.endsAt = '2030-01-01T12:35:00Z'; },
    s => { s.auction.status = 'ENDED'; },
  ];
  for (const edit of edits) { const s = structuredClone(good); edit(s);
    assert.equal(judgeConcurrentSql(input, s, actors, endsAt).valid, false); }
  assert.equal(judgeConcurrentSql(input, null, actors, endsAt).valid, false);
  assert.equal(judgeConcurrentSql(input, good, { A: actors.A, B: actors.A }, endsAt).valid, false);
});

test('SQL preserves request settlement v2 while validating a private snapshot at v3 against the accepted chain', async () => {
  const { input } = await collectConcurrentRound(fake().io);
  const good = snapshot(input);
  Object.assign(input.frames[0].result, { currentPrice: 12000, auctionVersion: 3 });
  const result = judgeConcurrentSql(input, good, actors, endsAt);
  assert.equal(result.valid, true);
  assert.deepEqual(result.settlements.map(s => [s.bidder, s.settlementVersion, s.ledgerPrice, s.snapshotVersion, s.snapshotPrice]),
    [['A', 2, 11000, 3, 12000], ['B', 3, 12000, 3, 12000]]);
  for (const edit of [
    s => { s.rows[0].events[0].version = 3; },
    s => { s.rows[0].events[0].price = 12000; },
    s => { s.rows[0].ledgers[0].price = 12000; },
    s => { s.auction.version = 4; },
    s => { s.rows[1].events[0].version = 4; },
    s => { s.rows[1].bidderId = actors.A; },
  ]) { const bad = structuredClone(good); edit(bad); assert.equal(judgeConcurrentSql(input, bad, actors, endsAt).valid, false); }
});

test('SQL reader is fixed to local Docker/psql with read-only transaction and rejects unsafe IDs before execution', async () => {
  let calls = 0;
  const command = async (program, args, options) => {
    calls++; assert.equal(program, 'docker'); assert.equal(args[0], 'exec');
    assert.equal(args[1], 'bidflow-local-postgres-1'); assert.equal(options.timeout, 5000);
    const query = args.at(-1);
    assert.match(query, /BEGIN READ ONLY/); assert.match(query, /statement_timeout/);
    assert.ok(!/INSERT|UPDATE|DELETE|TRUNCATE|DROP/i.test(query));
    assert.ok(query.includes(auctionId)); assert.ok(query.includes(id(1))); assert.ok(query.includes(id(2)));
    return { stdout: '{"requestCount":2}' };
  };
  assert.deepEqual(await readConcurrentSql(auctionId, [id(1), id(2)], command), { requestCount: 2 });
  assert.equal(calls, 1);
  for (const ids of [[id(1)], [id(1), id(1)], [id(1), "'; DROP TABLE auction; --"]]) {
    await assert.rejects(readConcurrentSql(auctionId, ids, command));
  }
  assert.throws(() => buildConcurrentSql('remote', [id(1), id(2)]));
  assert.equal(calls, 1);
  await assert.rejects(readConcurrentSql(auctionId, [id(1), id(2)], async () => ({ stdout: 'malformed' })));
});
