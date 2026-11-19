import test from 'node:test';
import assert from 'node:assert/strict';
import { isFinal, percentiles, measure } from '../../scripts/final-settlement.mjs';

const auction = '729d18a8-9f36-4228-a868-e278cf10e501';
const id = '729d18a8-9f36-4228-a868-e278cf10e502';
const row = { id, auctionId: auction, status: 'ACCEPTED', ledgerCount: 1, decision: 'ACCEPTED', resultCount: 1, eventType: 'BidAccepted' };

test('only matching request, ledger and result event constitute final settlement', () => {
  assert(isFinal(row, id, auction));
  assert(isFinal({ ...row, status: 'REJECTED', decision: 'REJECTED', eventType: 'BidRejected' }, id, auction));
  for (const patch of [{ id: auction }, { auctionId: id }, { status: 'RECEIVED' }, { ledgerCount: 0 }, { ledgerCount: 2 },
    { decision: 'REJECTED' }, { resultCount: 0 }, { resultCount: 2 }, { eventType: 'AuctionExtended' }]) {
    assert.equal(isFinal({ ...row, ...patch }, id, auction), false);
  }
});

test('nearest-rank percentiles handle empty, unsorted, equal and zero samples', () => {
  assert.deepEqual(percentiles([]), { count: 0, p50: null, p95: null, p99: null });
  assert.deepEqual(percentiles([0, 0]), { count: 2, p50: 0, p95: 0, p99: 0 });
  const samples = [20, ...Array.from({ length: 19 }, (_, i) => i + 1)];
  assert.deepEqual(percentiles(samples), { count: 20, p50: 10, p95: 19, p99: 20 });
  assert.equal(samples[0], 20);
  assert.throws(() => percentiles([NaN]));
});

function harness(patch = {}) {
  let time = 0;
  return { auctionId: auction, count: 1, timeoutMs: 1000, now: () => time,
    wait: async ms => { time += ms; },
    submit: async () => ({ status: 202, body: { bidRequestId: id, status: 'RECEIVED' } }),
    read: async () => [row], ...patch };
}

test('records final DB observation after submission and includes query intervals', async () => {
  const result = await measure(harness());
  assert.equal(result.completed, 1);
  assert.equal(result.samples[0].decision, 'ACCEPTED');
  assert(result.samples[0].finalObservedMs >= result.samples[0].httpCompletedMs);
  assert.equal(result.finalObservation.count, 1);
  assert.equal(result.valid, true);
  assert(result.queries.length >= 1);
});

test('records failed HTTP, malformed responses and duplicate IDs without successful samples', async () => {
  for (const submit of [async () => { throw Error('token-secret'); }, async () => ({ status: 500, body: {} }),
    async () => ({ status: 202, body: { status: 'RECEIVED', bidRequestId: 'bad' } })]) {
    const result = await measure(harness({ submit }));
    assert.equal(result.valid, false);
    assert.equal(result.completed, 0);
    assert.equal(result.finalObservation.p95, null);
    assert(!JSON.stringify(result).includes('token-secret'));
  }
  const duplicate = await measure(harness({ count: 2 }));
  assert.equal(duplicate.valid, false);
  assert(duplicate.samples.some(s => s.error === 'DUPLICATE_ID'));
});

test('timeouts do not become zero latency samples and DB errors invalidate the run', async () => {
  const result = await measure(harness({ read: async () => [] }));
  assert.equal(result.completed, 0);
  assert.equal(result.incomplete, 1);
  assert.equal(result.finalObservation.p95, null);
  assert.equal(result.valid, false);
  assert.equal(result.samples[0].error, 'OBSERVATION_TIMEOUT');
  const failed = await measure(harness({ read: async () => { throw Error('password'); } }));
  assert.equal(failed.error, 'DB_OBSERVATION_FAILED');
  assert(!JSON.stringify(failed).includes('password'));
});

test('rejects late DB results and never overlaps reads', async () => {
  let active = false;
  let time = 0;
  const result = await measure(harness({ now: () => time, wait: async ms => { time += ms; }, read: async () => {
    assert.equal(active, false); active = true; time += 1100; active = false; return [row];
  } }));
  assert.equal(result.completed, 0);
  assert.equal(result.samples[0].error, 'OBSERVATION_TIMEOUT');
});

test('late HTTP responses and malformed DB replies invalidate the run', async () => {
  let time = 0;
  const late = await measure(harness({ now: () => time, wait: async ms => { time += ms; },
    submit: async () => { time += 1100; return { status: 202, body: { status: 'RECEIVED', bidRequestId: id } }; } }));
  assert.equal(late.valid, false);
  assert.equal(late.samples[0].error, 'HTTP_TIMEOUT');
  for (const response of [null, {}, [null]]) {
    const invalid = await measure(harness({ read: async () => response }));
    assert.equal(invalid.error, 'DB_OBSERVATION_FAILED');
  }
});
