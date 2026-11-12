package com.bidflow.application.search;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SearchIndexingServiceTest {

    private static final UUID PRODUCT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void rebuildsTheProductDocumentFromTheCurrentSource() {
        InMemorySource source = new InMemorySource(document());
        CapturingWriter writer = new CapturingWriter();
        SearchIndexingService service = new SearchIndexingService(source, writer);

        service.indexProduct(PRODUCT_ID);

        assertThat(writer.indexed).containsExactly(document());
    }

    @Test
    void doesNotWriteWhenTheProductNoLongerExists() {
        CapturingWriter writer = new CapturingWriter();
        SearchIndexingService service = new SearchIndexingService(new InMemorySource(null), writer);

        service.indexProduct(PRODUCT_ID);

        assertThat(writer.indexed).isEmpty();
    }

    @Test
    void rebuildsTheProductDocumentFromAnAuctionEvent() {
        InMemorySource source = new InMemorySource(document());
        CapturingWriter writer = new CapturingWriter();
        SearchIndexingService service = new SearchIndexingService(source, writer);

        service.indexAuction(AUCTION_ID);

        assertThat(writer.indexed).containsExactly(document());
    }

    private static ProductSearchDocument document() {
        return new ProductSearchDocument(
                PRODUCT_ID, AUCTION_ID, "seller-1", "중고 카메라", "DIGITAL", "GOOD", "products/seller-1/thumbnail",
                50_000L, 55_000L, "ACTIVE", true,
                Instant.parse("2026-11-12T00:10:00Z"), Instant.parse("2026-11-12T01:00:00Z"), 2L, 3L,
                Instant.parse("2026-11-12T00:20:00Z"));
    }

    private static final class InMemorySource implements ProductSearchDocumentSource {
        private final ProductSearchDocument document;

        private InMemorySource(ProductSearchDocument document) {
            this.document = document;
        }

        @Override
        public Optional<ProductSearchDocument> findByProductId(UUID productId) {
            return document != null && document.productId().equals(productId) ? Optional.of(document) : Optional.empty();
        }

        @Override
        public Optional<ProductSearchDocument> findByAuctionId(UUID auctionId) {
            return document != null && document.auctionId().equals(auctionId) ? Optional.of(document) : Optional.empty();
        }
    }

    private static final class CapturingWriter implements ProductSearchDocumentWriter {
        private final ArrayList<ProductSearchDocument> indexed = new ArrayList<>();

        @Override
        public void upsert(ProductSearchDocument document) {
            indexed.add(document);
        }
    }
}
