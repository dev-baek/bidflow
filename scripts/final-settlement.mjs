const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = value => typeof value === 'string' && uuid.test(value);

export function isFinal(row, id, auctionId) {
  return row?.id === id && row.auctionId === auctionId && ['ACCEPTED', 'REJECTED'].includes(row.status)
    && row.ledgerCount === 1 && row.resultCount === 1 && row.decision === row.status
    && row.eventType === (row.status === 'ACCEPTED' ? 'BidAccepted' : 'BidRejected');
}

export function percentiles(values) {
  if (values.some(v => !Number.isFinite(v) || v < 0)) throw Error('invalid latency');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { count: sorted.length, p50: rank(0.5), p95: rank(0.95), p99: rank(0.99) };
}

export async function measure({ auctionId, submit, read, now, wait, count = 20, timeoutMs = 60000 }) {
  if (!isUuid(auctionId) || !Number.isInteger(count) || count < 1 || count > 20 || timeoutMs <= 0 || timeoutMs > 60000) throw Error('invalid measurement input');
  const origin = now();
  const elapsed = () => now() - origin;
  const samples = [];
  const queries = [];
  let submissionsDone = false;
  let error;
  const observe = async () => {
    while (elapsed() < timeoutMs) {
      const pending = samples.filter(s => s.id && !s.error && s.finalObservedMs === undefined);
      if (pending.length) {
        const startedMs = elapsed();
        let rows;
        try {
          rows = await read(pending.map(s => s.id), Math.min(5000, timeoutMs - startedMs));
          if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object')) throw Error('invalid observation');
        }
        catch { error = 'DB_OBSERVATION_FAILED'; break; }
        const completedMs = elapsed();
        queries.push({ startedMs, completedMs, requestCount: pending.length });
        if (completedMs >= timeoutMs) break;
        for (const sample of pending) {
          const row = rows.find(r => r.id === sample.id);
          if (isFinal(row, sample.id, auctionId)) {
            Object.assign(sample, { finalObservedMs: completedMs, finalLatencyMs: completedMs - sample.startedMs,
              decision: row.status, ledgerCount: row.ledgerCount, resultCount: row.resultCount,
              processingStartMs: row.processingStartMs ?? null });
          }
        }
      }
      if (submissionsDone && samples.every(s => s.error || s.finalObservedMs !== undefined)) break;
      await wait(Math.min(100, Math.max(0, timeoutMs - elapsed())));
    }
  };
  const observer = observe();
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const sample = { index, auctionId, startedMs: elapsed() };
    samples.push(sample);
    try {
      const response = await submit(index, Math.min(5000, Math.max(1, timeoutMs - elapsed())));
      sample.httpCompletedMs = elapsed();
      sample.httpLatencyMs = sample.httpCompletedMs - sample.startedMs;
      sample.httpStatus = response.status;
      if (sample.httpCompletedMs >= timeoutMs) { sample.error = 'HTTP_TIMEOUT'; return; }
      if (response.status !== 202 || response.body?.status !== 'RECEIVED' || !isUuid(response.body?.bidRequestId)) {
        sample.error = 'INVALID_RECEIPT'; return;
      }
      sample.id = response.body.bidRequestId;
      const duplicates = samples.filter(s => s !== sample && s.id === sample.id);
      if (duplicates.length) for (const duplicate of [...duplicates, sample]) {
        duplicate.error = 'DUPLICATE_ID'; delete duplicate.finalObservedMs; delete duplicate.finalLatencyMs;
      }
    } catch { sample.httpCompletedMs = elapsed(); sample.error = 'HTTP_FAILED'; }
  }));
  submissionsDone = true;
  await observer;
  const endedMs = elapsed();
  for (const sample of samples) if (!sample.error && sample.finalObservedMs === undefined) {
    sample.error = error ?? 'OBSERVATION_TIMEOUT'; sample.unconfirmedElapsedMs = endedMs - sample.startedMs;
  }
  const completed = samples.filter(s => !s.error && s.finalObservedMs !== undefined);
  const gaps = queries.slice(1).map((q, i) => q.completedMs - queries[i].completedMs);
  return { valid: !error && completed.length === count, error, total: count, completed: completed.length,
    incomplete: count - completed.length, endedMs, samples, queries,
    maxQueryCompletionGapMs: gaps.length ? Math.max(...gaps) : null,
    http: percentiles(samples.filter(s => s.httpLatencyMs !== undefined && s.httpStatus === 202 && !['INVALID_RECEIPT', 'DUPLICATE_ID', 'HTTP_TIMEOUT'].includes(s.error)).map(s => s.httpLatencyMs)),
    finalObservation: percentiles(completed.map(s => s.finalLatencyMs)),
    decisions: { accepted: completed.filter(s => s.decision === 'ACCEPTED').length, rejected: completed.filter(s => s.decision === 'REJECTED').length } };
}
