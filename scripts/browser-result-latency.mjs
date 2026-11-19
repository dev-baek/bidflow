// The caller uses the existing bid.result parser before matching a collected frame.
export function matchesObservedBid(result, { requestId, auctionId, amount }) {
  return result?.bidRequestId === requestId && result.auctionId === auctionId
    && result.currentPrice === amount && result.decision === 'ACCEPTED' && result.isHighestBidder === true;
}

export function observationTimings(privateMs, fineMs, baselineMs) {
  if (![privateMs, fineMs, baselineMs].every(value => Number.isFinite(value) && value >= 0)
    || fineMs < privateMs || baselineMs < privateMs) throw Error('invalid paired observation');
  return { fineAfterPrivateMs: fineMs - privateMs, baselineAfterPrivateMs: baselineMs - privateMs,
    baselineMinusFineMs: baselineMs - fineMs };
}
