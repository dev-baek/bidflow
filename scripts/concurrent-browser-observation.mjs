import { isUuid, percentiles } from './final-settlement.mjs';

const time = value => Number.isFinite(value) && value >= 0;
const unique = values => new Set(values).size === values.length;
const bidders = ['A', 'B'];

// Inputs contain parsed bid.result messages, never raw WebSocket frames or tokens.
export function judgeConcurrentRound(input) {
  const failure = error => ({ index: Number.isInteger(input?.index) && input.index >= 0 && input.index < 10 ? input.index : null,
    auctionId: isUuid(input?.auctionId) ? input.auctionId : null,
    valid: false, concurrent: false, errors: [error], samples: [] });
  if (!input || !Number.isInteger(input.index) || input.index < 0 || input.index > 9
    || !isUuid(input.auctionId) || !Array.isArray(input.receipts) || input.receipts.length !== 2
    || !Array.isArray(input.frames)) return failure('INVALID_ROUND');
  const receipts = bidders.map(bidder => input.receipts.find(r => r?.bidder === bidder));
  if (receipts.some((r, i) => !r || !isUuid(r.requestId) || r.amount !== 11000 + i * 1000
    || r.httpStatus !== 202 || r.receiptStatus !== 'RECEIVED'
    || ![r.startedMs, r.postMs, r.httpCompletedMs].every(time)
    || r.postMs < r.startedMs || r.httpCompletedMs < r.postMs)
    || !unique(receipts.map(r => r.requestId))) return failure('INVALID_RECEIPT');

  const matched = [];
  for (const [index, receipt] of receipts.entries()) {
    const frames = input.frames.filter(f => f?.result?.bidRequestId === receipt.requestId);
    if (!frames.length) return failure('MISSING_RESULT');
    for (const frame of frames) {
      const result = frame.result;
      const accepted = result.decision === 'ACCEPTED' && result.reason === null && result.currentPrice === receipt.amount;
      const rejected = index === 0 && result.decision === 'REJECTED' && result.reason === 'BID_TOO_LOW'
        && result.currentPrice === 12000;
      if (frame.bidder !== receipt.bidder || result.auctionId !== input.auctionId || result.type !== 'bid.result'
        || !Number.isSafeInteger(result.auctionVersion) || result.auctionVersion < 2
        || typeof result.isHighestBidder !== 'boolean' || !(accepted || rejected)
        || !time(frame.receivedMs) || frame.receivedMs < receipt.postMs) return failure('INVALID_RESULT');
    }
    const first = frames.reduce((a, b) => a.receivedMs <= b.receivedMs ? a : b);
    if (frames.some(f => ['decision', 'reason', 'currentPrice', 'auctionVersion', 'isHighestBidder']
      .some(key => f.result[key] !== first.result[key]))) return failure('CONFLICTING_RESULT');
    matched.push(first);
  }

  const screen = input.screen;
  if (!screen || !time(screen.completedMs) || !Array.isArray(screen.prices) || screen.prices.length !== 2
    || !screen.prices.every(price => price === 12000) || !Array.isArray(screen.decisions) || screen.decisions.length !== 2
    || receipts.some((r, i) => screen.completedMs < Math.max(r.httpCompletedMs, matched[i].receivedMs)
      || screen.completedMs - r.startedMs >= 10000
      || screen.decisions.filter(s => s?.bidder === r.bidder && s.decision === matched[i].result.decision).length !== 1)) {
    return failure('INVALID_SCREEN_OR_TIMEOUT');
  }

  const concurrent = Math.max(...receipts.map(r => r.postMs)) < Math.min(...matched.map(f => f.receivedMs));
  return { index: input.index, auctionId: input.auctionId, valid: concurrent, concurrent,
    errors: concurrent ? [] : ['NOT_CONCURRENT'],
    postSkewMs: Math.abs(receipts[0].postMs - receipts[1].postMs),
    samples: receipts.map((r, i) => ({ bidder: r.bidder, requestId: r.requestId,
      decision: matched[i].result.decision, reason: matched[i].result.reason,
      amount: r.amount, auctionVersion: matched[i].result.auctionVersion,
      startedMs: r.startedMs, postMs: r.postMs, httpCompletedMs: r.httpCompletedMs,
      privateReceivedMs: matched[i].receivedMs, screenCompletedMs: screen.completedMs,
      httpMs: r.httpCompletedMs - r.startedMs, privateMs: matched[i].receivedMs - r.startedMs,
      screenMs: screen.completedMs - r.startedMs })) };
}

export function summarizeConcurrentRun(inputs) {
  if (!Array.isArray(inputs) || inputs.length > 10) throw Error('expected at most ten rounds');
  const rounds = inputs.map(judgeConcurrentRound);
  const samples = rounds.flatMap(r => r.samples);
  const distinct = unique(rounds.map(r => r.index)) && unique(rounds.map(r => r.auctionId))
    && unique(samples.map(s => s.requestId));
  const observationValid = rounds.length === 10 && rounds.every(r => r.valid) && samples.length === 20 && distinct;
  const screen = percentiles(samples.map(s => s.screenMs));
  // SQL agreement is a separate boundary; browser observations alone cannot validate the whole experiment.
  return { valid: false, sqlVerified: false, observationValid,
    p95WithinTarget: observationValid && screen.p95 <= 2000,
    total: 20, completed: samples.length, incomplete: 20 - samples.length,
    unexecutedRounds: 10 - rounds.length, nonconcurrentRounds: rounds.filter(r => r.errors.includes('NOT_CONCURRENT')).length,
    distinct, rounds, screen, privateResult: percentiles(samples.map(s => s.privateMs)),
    http: percentiles(samples.map(s => s.httpMs)),
    decisions: { accepted: samples.filter(s => s.decision === 'ACCEPTED').length,
      rejected: samples.filter(s => s.decision === 'REJECTED').length } };
}
