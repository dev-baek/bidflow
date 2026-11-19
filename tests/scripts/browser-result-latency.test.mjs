import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesObservedBid } from '../../scripts/browser-result-latency.mjs';

test('matches only the current request, auction, price and highest-bidder approval', () => {
  const expected = { requestId: 'new-request', auctionId: 'auction-1', amount: 12000 };
  const result = { bidRequestId: 'new-request', auctionId: 'auction-1', currentPrice: 12000, decision: 'ACCEPTED', isHighestBidder: true };
  assert(matchesObservedBid(result, expected));
  for (const patch of [{ bidRequestId: 'previous-request' }, { auctionId: 'another-auction' },
    { currentPrice: 11000 }, { decision: 'REJECTED' }, { isHighestBidder: false }]) {
    assert.equal(matchesObservedBid({ ...result, ...patch }, expected), false);
  }
  assert.equal(matchesObservedBid(undefined, expected), false);
});
