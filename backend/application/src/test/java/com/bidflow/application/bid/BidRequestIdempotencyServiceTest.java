package com.bidflow.application.bid;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.*;
import org.junit.jupiter.api.Test;

class BidRequestIdempotencyServiceTest {
    @Test void returnsTheOriginalRequestIdForTheSameBidderKeyAndPayload() {
        InMemoryRepository repository = new InMemoryRepository();
        BidRequestIdempotencyService service = new BidRequestIdempotencyService(repository, UUID::randomUUID);
        BidRequestCommand command = new BidRequestCommand(UUID.randomUUID(), "DIRECT", 5_000L);

        UUID first = service.receive("bidder-1", "request-1", "correlation-1", command);
        UUID retried = service.receive("bidder-1", "request-1", "correlation-2", command);

        assertThat(retried).isEqualTo(first);
        assertThat(repository.requests).hasSize(1);
        assertThat(repository.savedCorrelationId).isEqualTo("correlation-1");
    }
    private static final class InMemoryRepository implements BidRequestRepository {
        private final Map<String, UUID> requests = new HashMap<>();
        private String savedCorrelationId;
        public Optional<UUID> find(String bidder, String key, String hash) { return Optional.ofNullable(requests.get(bidder + key + hash)); }
        public void save(String bidder, String key, String hash, String correlationId, UUID requestId, BidRequestCommand command) {
            savedCorrelationId = correlationId;
            requests.put(bidder + key + hash, requestId);
        }
    }
}
