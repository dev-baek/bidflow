package com.bidflow.domain.listing;

import java.util.Objects;

public record AuctionExtension(Auction auction, boolean extended) {
    public AuctionExtension {
        auction = Objects.requireNonNull(auction, "auction must not be null");
    }
}
