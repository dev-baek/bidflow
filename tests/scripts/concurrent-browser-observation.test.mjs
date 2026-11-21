import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeConcurrentRound, summarizeConcurrentRun } from '../../scripts/concurrent-browser-observation.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function round(index = 0, rejected = false) {
  const auctionId = id(100 + index);
  const receipts = ['A', 'B'].map((bidder, i) => ({ bidder, requestId: id(index * 2 + i + 1),
    amount: 11000 + i * 1000, startedMs: 100 + i, postMs: 105 + i,
    httpCompletedMs: 150 + i, httpStatus: 202, receiptStatus: 'RECEIVED' }));
  const frames = receipts.map((r, i) => ({ bidder: r.bidder, receivedMs: 140 + i * 40,
    result: { type: 'bid.result', bidRequestId: r.requestId, auctionId, auctionVersion: 2 + i,
      decision: rejected && i === 0 ? 'REJECTED' : 'ACCEPTED',
      reason: rejected && i === 0 ? 'BID_TOO_LOW' : null,
      currentPrice: rejected && i === 0 ? 12000 : r.amount, isHighestBidder: !(rejected && i === 0) } }));
  if (rejected) { frames[0].receivedMs = 190; frames[0].result.auctionVersion = 2; frames[1].result.auctionVersion = 2; }
  return { index, auctionId, receipts, frames, screen: { completedMs: 200,
    prices: [12000, 12000], decisions: frames.map(f => ({ bidder: f.bidder, decision: f.result.decision })) } };
}

test('accepts either valid ordering, keeps response-before/frame-before receipt independent, and never mutates input', () => {
  for (const rejected of [false, true]) {
    const input = round(0, rejected), before = structuredClone(input);
    const result = judgeConcurrentRound(input);
    assert.equal(result.valid, true); assert.equal(result.concurrent, true);
    assert.equal(result.samples.length, 2); assert.equal(result.samples[0].screenMs, 100);
    assert.equal(result.samples[1].screenMs, 99);
    assert.equal(result.samples[0].decision, rejected ? 'REJECTED' : 'ACCEPTED');
    assert.equal(result.postSkewMs, 1); assert.deepEqual(input, before);
  }
});

test('an accepted low bid can carry a later valid snapshot without becoming a different settlement', () => {
  const input = round();
  input.frames[0].result.currentPrice = 12000;
  input.frames[0].result.auctionVersion = 3;
  const before = structuredClone(input);
  const verdict = judgeConcurrentRound(input);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.samples[0].amount, 11000);
  assert.equal(verdict.samples[0].snapshotPrice, 12000);
  assert.equal(verdict.samples[0].snapshotVersion, 3);
  assert.equal('auctionVersion' in verdict.samples[0], false);
  assert.deepEqual(input, before);
});

test('only the specified snapshot pairs are permitted, not arbitrary greater versions', () => {
  for (const rejected of [false, true]) {
    for (const bidder of [0, 1]) {
      const allowed = !rejected && bidder === 0 ? [[2, 11000], [3, 12000]] : [[rejected ? 2 : 3, 12000]];
      for (const version of [1, 2, 3, 4, NaN]) for (const price of [10000, 11000, 12000, 13000, NaN]) {
        const input = round(0, rejected);
        Object.assign(input.frames[bidder].result, { auctionVersion: version, currentPrice: price });
        assert.equal(judgeConcurrentRound(input).valid, allowed.some(([v, p]) => v === version && p === price),
          `rejected=${rejected} bidder=${bidder} pair=${version}/${price}`);
      }
    }
  }
});

test('duplicate delivery does not create a sample, while cross-channel leakage and conflicting results fail', () => {
  const input = round(); input.frames.push(structuredClone(input.frames[0]));
  assert.equal(judgeConcurrentRound(input).samples.length, 2);
  assert.equal(judgeConcurrentRound(input).valid, true);
  input.frames.at(-1).bidder = 'B';
  assert.equal(judgeConcurrentRound(input).valid, false);
  const conflict = round(); conflict.frames.push(structuredClone(conflict.frames[0]));
  conflict.frames.at(-1).result.decision = 'REJECTED';
  assert.equal(judgeConcurrentRound(conflict).valid, false);
});

test('wrong request/auction, high rejection, unexpected rejection, duplicate receipt and wrong screen fail closed', () => {
  const changes = [
    r => { r.frames[0].result.bidRequestId = id(999); },
    r => { r.frames[0].result.auctionId = id(999); },
    r => { r.frames[1].result.decision = 'REJECTED'; },
    r => { r.frames[0].result.decision = 'REJECTED'; r.frames[0].result.reason = 'SELF_BID'; },
    r => { r.receipts[1].requestId = r.receipts[0].requestId; },
    r => { r.screen.prices[1] = 11000; },
    r => { r.screen.decisions[0].decision = 'REJECTED'; },
    r => { r.receipts[0].httpStatus = 500; },
    r => { r.receipts[0].receiptStatus = 'PENDING'; },
    r => { r.receipts[0].requestId = 'invalid'; },
    r => { r.receipts[0].amount = 13000; },
  ];
  for (const change of changes) { const input = round(); change(input); assert.equal(judgeConcurrentRound(input).valid, false); }
});

test('invalid time order, non-finite values, timeout and missing observation cannot become successful latency', () => {
  const changes = [
    r => { r.receipts[0].postMs = 99; }, r => { r.receipts[0].httpCompletedMs = 100; },
    r => { r.frames[0].receivedMs = 104; }, r => { r.screen.completedMs = 170; },
    r => { r.screen.completedMs = 10100; }, r => { r.receipts[0].startedMs = NaN; },
    r => { r.frames = []; }, r => { delete r.screen; },
  ];
  for (const change of changes) { const input = round(); change(input); const result = judgeConcurrentRound(input);
    assert.equal(result.valid, false); assert.equal(result.samples.length, 0); }
  for (const input of [null, {}, { receipts: null }, { index: 0, auctionId: id(1), receipts: [], frames: [] }]) {
    assert.equal(judgeConcurrentRound(input).valid, false);
  }
});

test('Promise.all intent is insufficient: the second POST must precede the first private result', () => {
  for (const postMs of [140, 141]) { const input = round(); input.receipts[1].postMs = postMs;
    const result = judgeConcurrentRound(input); assert.equal(result.valid, false);
    assert.equal(result.concurrent, false); assert.equal(result.samples.length, 2); }
});

test('summary requires ten distinct rounds and twenty distinct requests; partial data and nonconcurrent rounds remain failures', () => {
  const inputs = Array.from({ length: 10 }, (_, i) => round(i, i % 2 === 0));
  const summary = summarizeConcurrentRun(inputs);
  assert.equal(summary.observationValid, true); assert.equal(summary.p95WithinTarget, true);
  assert.equal(summary.completed, 20); assert.equal(summary.incomplete, 0);
  assert.deepEqual(summary.decisions, { accepted: 15, rejected: 5 });
  assert.equal(summary.screen.p95, 100);
  assert.equal(summarizeConcurrentRun([]).screen.p95, null);
  assert.equal(summarizeConcurrentRun(inputs.slice(1)).observationValid, false);
  const duplicate = structuredClone(inputs); duplicate[1] = duplicate[0];
  assert.equal(summarizeConcurrentRun(duplicate).observationValid, false);
  const sameAuction = structuredClone(inputs); sameAuction[1].auctionId = sameAuction[0].auctionId;
  sameAuction[1].frames.forEach(f => { f.result.auctionId = sameAuction[0].auctionId; });
  assert.equal(summarizeConcurrentRun(sameAuction).observationValid, false);
  const ids = structuredClone(inputs); ids[1].receipts[0].requestId = ids[0].receipts[0].requestId;
  ids[1].frames[0].result.bidRequestId = ids[0].receipts[0].requestId;
  assert.equal(summarizeConcurrentRun(ids).observationValid, false);
  const noOverlap = structuredClone(inputs); noOverlap[0].receipts[1].postMs = 180;
  noOverlap[0].receipts[1].httpCompletedMs = 181;
  assert.equal(summarizeConcurrentRun(noOverlap).nonconcurrentRounds, 1);
  assert.equal(summarizeConcurrentRun(noOverlap).p95WithinTarget, false);
  const slow = structuredClone(inputs); slow.forEach(r => { r.screen.completedMs = 3000; });
  assert.equal(summarizeConcurrentRun(slow).observationValid, true);
  assert.equal(summarizeConcurrentRun(slow).p95WithinTarget, false);
  assert.throws(() => summarizeConcurrentRun(null));
  assert.throws(() => summarizeConcurrentRun([...inputs, round()]));
});

test('evidence returns only allowed fields and explicitly leaves SQL agreement unverified', () => {
  const input = round(); input.token = 'do-not-copy'; input.frames[0].result.secret = 'do-not-copy';
  const result = summarizeConcurrentRun([input]);
  assert.equal(JSON.stringify(result).includes('do-not-copy'), false);
  assert.equal(result.sqlVerified, false); assert.equal(result.valid, false);
});
