package com.bidflow.application.search;

import java.util.UUID;

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
}
