package com.bidflow.application.auction;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.ProductImagePolicy;
import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public final class PublicAuctionImages {
    private final PublicAuctionImageReader reader;
    private final ObjectStorage storage;

    public PublicAuctionImages(PublicAuctionImageReader reader, ObjectStorage storage) {
        this.reader = reader;
        this.storage = storage;
    }

    public Optional<List<UUID>> imageIds(UUID auctionId) {
        return reader.findImageIds(auctionId);
    }

    public Optional<URI> read(UUID auctionId, UUID imageId) {
        return readUrl(reader.findObjectKey(auctionId, imageId));
    }

    public Optional<URI> thumbnail(UUID auctionId) {
        return readUrl(reader.findThumbnailObjectKey(auctionId));
    }

    private Optional<URI> readUrl(Optional<String> objectKey) {
        return objectKey.filter(key -> storage.headObject(key).filter(ProductImagePolicy::accepts).isPresent())
                .map(storage::presignRead);
    }
}
