package com.bidflow.application.search;

import java.util.Optional;
import java.util.UUID;

public interface ProductSearchDocumentSource {
    Optional<ProductSearchDocument> findByProductId(UUID productId);
    Optional<ProductSearchDocument> findByAuctionId(UUID auctionId);
}
