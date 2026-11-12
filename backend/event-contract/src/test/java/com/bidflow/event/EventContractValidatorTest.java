package com.bidflow.event;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventContractValidatorTest {

    private static final Instant OCCURRED_AT = Instant.parse("2026-11-12T00:00:00Z");

    @Test
    void acceptsListingPublishedWithDocumentedTopicKeyAndPayload() {
        EventEnvelope<Map<String, Object>> event = envelope(Map.of(
                "productId", "product-1",
                "sellerId", "seller-1",
                "title", "중고 카메라",
                "categoryId", "DIGITAL",
                "publishedAt", "2026-11-12T00:00:00Z",
                "listingVersion", 1));

        assertThat(EventContractValidator.validate("listing-event", "product-1", event)).isEmpty();
    }

    @Test
    void rejectsListingPublishedWithoutARequiredPayloadField() {
        EventEnvelope<Map<String, Object>> event = envelope(Map.of(
                "productId", "product-1",
                "sellerId", "seller-1",
                "title", "중고 카메라",
                "categoryId", "DIGITAL",
                "publishedAt", "2026-11-12T00:00:00Z"));

        assertThat(EventContractValidator.validate("listing-event", "product-1", event))
                .containsExactly(EventContractViolation.requiredPayloadFieldMissing("listingVersion"));
    }

    @Test
    void rejectsAKeyThatDoesNotMatchTheDocumentedProductId() {
        EventEnvelope<Map<String, Object>> event = envelope(Map.of(
                "productId", "product-1",
                "sellerId", "seller-1",
                "title", "중고 카메라",
                "categoryId", "DIGITAL",
                "publishedAt", "2026-11-12T00:00:00Z",
                "listingVersion", 1));

        assertThat(EventContractValidator.validate("listing-event", "seller-1", event))
                .containsExactly(EventContractViolation.partitionKeyMismatch("productId"));
    }

    @Test
    void exposesEveryContractDefinedForTheInitialTopics() {
        assertThat(EventContracts.all())
                .extracting(EventContract::eventType)
                .containsExactlyInAnyOrder(
                        "BidCommandRequested", "BidAccepted", "BidRejected", "AuctionExtended", "AuctionEnded",
                        "ListingPublished", "ListingUpdated", "ListingUnpublished");
    }

    private static EventEnvelope<Map<String, Object>> envelope(Map<String, Object> payload) {
        return new EventEnvelope<>(
                UUID.fromString("b9347c5f-b02f-4a67-89c9-2d2272ed1a32"),
                "ListingPublished",
                1,
                OCCURRED_AT,
                "request-1",
                payload);
    }
}
