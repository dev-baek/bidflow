package com.bidflow.application.search;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
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

    @Test
    void reindexesEveryProductWithKeysetPagination() {
        ProductSearchDocument first = document(PRODUCT_ID);
        ProductSearchDocument second = document(UUID.fromString("00000000-0000-0000-0000-000000000003"));
        CapturingWriter writer = new CapturingWriter();
        SearchIndexingService service = new SearchIndexingService(new PagedSource(List.of(second, first)), writer);

        int indexedCount = service.reindexAll(1);

        assertThat(indexedCount).isEqualTo(2);
        assertThat(writer.indexed).extracting(ProductSearchDocument::productId).containsExactly(PRODUCT_ID, second.productId());
    }

    private static ProductSearchDocument document() {
        return document(PRODUCT_ID);
    }

    private static ProductSearchDocument document(UUID productId) {
        return new ProductSearchDocument(
                productId, AUCTION_ID, "seller-1", "중고 카메라", "DIGITAL", "GOOD", "products/seller-1/thumbnail",
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

    private static final class PagedSource implements ProductSearchDocumentSource {
        private final List<ProductSearchDocument> documents;

        private PagedSource(List<ProductSearchDocument> documents) {
            this.documents = documents.stream().sorted(Comparator.comparing(ProductSearchDocument::productId)).toList();
        }

        @Override public Optional<ProductSearchDocument> findByProductId(UUID productId) { return Optional.empty(); }
        @Override public Optional<ProductSearchDocument> findByAuctionId(UUID auctionId) { return Optional.empty(); }
        @Override public List<ProductSearchDocument> findPageAfter(UUID productId, int limit) {
            return documents.stream().filter(document -> productId == null || document.productId().compareTo(productId) > 0).limit(limit).toList();
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
