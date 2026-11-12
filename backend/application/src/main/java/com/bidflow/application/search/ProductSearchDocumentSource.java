package com.bidflow.application.search;

import java.util.Optional;
import java.util.List;
import java.util.UUID;

public interface ProductSearchDocumentSource {
    Optional<ProductSearchDocument> findByProductId(UUID productId);
    Optional<ProductSearchDocument> findByAuctionId(UUID auctionId);
    default List<ProductSearchDocument> findPageAfter(UUID productId, int limit) { return List.of(); }
}
