package com.bidflow.application.listing;

import com.bidflow.domain.listing.Auction;
import com.bidflow.domain.listing.ProductDraft;

import java.util.List;
import java.util.UUID;

public record NewListingRegistration(
        String sellerId,
        String idempotencyKey,
        String payloadHash,
        ListingRegistrationResult result,
        ProductDraft product,
        Auction auction,
        List<ListingImageRegistration> images,
        OutboxRegistration outbox
) {
    public NewListingRegistration {
        images = List.copyOf(images);
    }
}
