package com.bidflow.application.listing;

import java.util.UUID;

public record ListingRegistrationResult(UUID productId, UUID auctionId, String auctionStatus) {
}
