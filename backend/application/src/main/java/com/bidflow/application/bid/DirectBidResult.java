package com.bidflow.application.bid;

import java.time.Instant;

public record DirectBidResult(
        DirectBidResultCode code,
        long currentPrice,
        String winnerId,
        long winnerMaximum,
        Instant endsAt,
        long version
) {
}
