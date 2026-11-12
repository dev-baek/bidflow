package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.search.ProductSearchDocument;
import com.bidflow.application.search.ProductSearchDocumentSource;
import com.bidflow.application.search.ProductSearchDocumentWriter;
import com.bidflow.application.search.SearchIndexingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class SearchIndexingKafkaListenerTest {
    private static final UUID PRODUCT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void indexesCurrentProductStateForAValidListingPublishedEvent() {
        CapturingWriter writer = new CapturingWriter();
        SearchIndexingKafkaListener listener = listener(writer);

        listener.consume(new ConsumerRecord<>("listing-event", 0, 0L, PRODUCT_ID.toString(), validListingPublished()));

        assertThat(writer.documents).extracting(ProductSearchDocument::productId).containsExactly(PRODUCT_ID);
    }

    @Test
    void rejectsAnEventThatBreaksTheTopicPayloadContract() {
        CapturingWriter writer = new CapturingWriter();
        SearchIndexingKafkaListener listener = listener(writer);

        assertThatThrownBy(() -> listener.consume(new ConsumerRecord<>("listing-event", 0, 0L, PRODUCT_ID.toString(), """
                {"eventId":"b9347c5f-b02f-4a67-89c9-2d2272ed1a32","eventType":"ListingPublished","schemaVersion":1,
                 "occurredAt":"2026-11-12T00:00:00Z","correlationId":"request-1","payload":{"productId":"%s"}}
                """.formatted(PRODUCT_ID))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(writer.documents).isEmpty();
    }

    private static SearchIndexingKafkaListener listener(CapturingWriter writer) {
        ProductSearchDocument document = new ProductSearchDocument(
                PRODUCT_ID, AUCTION_ID, "seller-1", "중고 카메라", "DIGITAL", "GOOD", null,
                50_000L, 50_000L, "SCHEDULED", true,
                Instant.parse("2026-11-12T00:00:00Z"), Instant.parse("2026-11-12T01:00:00Z"), 1L, 1L,
                Instant.parse("2026-11-12T00:00:01Z"));
        ProductSearchDocumentSource source = new ProductSearchDocumentSource() {
            @Override public Optional<ProductSearchDocument> findByProductId(UUID productId) { return Optional.of(document); }
            @Override public Optional<ProductSearchDocument> findByAuctionId(UUID auctionId) { return Optional.of(document); }
        };
        return new SearchIndexingKafkaListener(new ObjectMapper(), new SearchIndexingService(source, writer));
    }

    private static String validListingPublished() {
        return """
                {"eventId":"b9347c5f-b02f-4a67-89c9-2d2272ed1a32","eventType":"ListingPublished","schemaVersion":1,
                 "occurredAt":"2026-11-12T00:00:00Z","correlationId":"request-1","payload":
                 {"productId":"%s","sellerId":"seller-1","title":"중고 카메라","categoryId":"DIGITAL",
                  "publishedAt":"2026-11-12T00:00:00Z","listingVersion":1}}
                """.formatted(PRODUCT_ID);
    }

    private static final class CapturingWriter implements ProductSearchDocumentWriter {
        private final ArrayList<ProductSearchDocument> documents = new ArrayList<>();
        @Override public void upsert(ProductSearchDocument document) { documents.add(document); }
    }
}
