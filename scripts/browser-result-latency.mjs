// The caller uses the existing bid.result parser before matching a collected frame.
export function matchesObservedBid(result, { requestId, auctionId, amount }) {
  return result?.bidRequestId === requestId && result.auctionId === auctionId
    && result.currentPrice === amount && result.decision === 'ACCEPTED' && result.isHighestBidder === true;
}
