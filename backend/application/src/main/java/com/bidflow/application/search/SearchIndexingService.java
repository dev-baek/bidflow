package com.bidflow.application.search;

import java.util.UUID;
import java.util.List;

public final class SearchIndexingService {
    private final ProductSearchDocumentSource source;
    private final ProductSearchDocumentWriter writer;

    public SearchIndexingService(ProductSearchDocumentSource source, ProductSearchDocumentWriter writer) {
        this.source = source;
        this.writer = writer;
    }

    public void indexProduct(UUID productId) {
        source.findByProductId(productId).ifPresent(writer::upsert);
    }

    public void indexAuction(UUID auctionId) {
        source.findByAuctionId(auctionId).ifPresent(writer::upsert);
    }

    public int reindexAll(int pageSize) {
        if (pageSize < 1) {
            throw new IllegalArgumentException("pageSize must be positive");
        }
        UUID cursor = null;
        int indexedCount = 0;
        while (true) {
            List<ProductSearchDocument> page = source.findPageAfter(cursor, pageSize);
            for (ProductSearchDocument document : page) {
                writer.upsert(document);
            }
            indexedCount += page.size();
            if (page.size() < pageSize) {
                return indexedCount;
            }
            UUID nextCursor = page.getLast().productId();
            if (cursor != null && nextCursor.compareTo(cursor) <= 0) {
                throw new IllegalStateException("search source cursor must advance");
            }
            cursor = nextCursor;
        }
    }
}
