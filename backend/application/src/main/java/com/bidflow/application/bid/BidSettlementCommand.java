package com.bidflow.application.bid;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Immutable input for persisting a final Redis Lua decision. */
public record BidSettlementCommand(
        UUID bidRequestId,
        UUID auctionId,
        String bidderId,
        long requestedAmount,
        DirectBidResult result,
        Instant processedAt,
        String correlationId
) {
    public BidSettlementCommand {
        Objects.requireNonNull(bidRequestId, "bidRequestId must not be null");
        Objects.requireNonNull(auctionId, "auctionId must not be null");
        Objects.requireNonNull(result, "result must not be null");
        Objects.requireNonNull(processedAt, "processedAt must not be null");
        if (bidderId == null || bidderId.isBlank() || correlationId == null || correlationId.isBlank()) {
            throw new IllegalArgumentException("bidderId and correlationId must not be blank");
        }
        if (requestedAmount < 1_000L) {
            throw new IllegalArgumentException("requestedAmount must be at least 1000");
        }
        if (result.code() == DirectBidResultCode.NOT_ACTIVE) {
            throw new IllegalArgumentException("NOT_ACTIVE must be recovered before settlement");
        }
    }

    public boolean accepted() {
        return result.code() == DirectBidResultCode.ACCEPTED;
    }
}
