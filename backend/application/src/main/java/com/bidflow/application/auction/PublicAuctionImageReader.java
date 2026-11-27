package com.bidflow.application.auction;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PublicAuctionImageReader {
    Optional<List<UUID>> findImageIds(UUID auctionId);
    Optional<String> findObjectKey(UUID auctionId, UUID imageId);
    Optional<String> findThumbnailObjectKey(UUID auctionId);
}
