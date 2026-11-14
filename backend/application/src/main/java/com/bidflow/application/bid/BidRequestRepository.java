package com.bidflow.application.bid;
import java.util.Optional;
import java.util.UUID;
public interface BidRequestRepository {
    Optional<UUID> find(String bidderId, String idempotencyKey, String payloadHash);
    void save(String bidderId, String idempotencyKey, String payloadHash, String correlationId, UUID requestId, BidRequestCommand command);
}
