package com.bidflow.event;

import java.util.List;
import java.util.Optional;

public final class EventContracts {
    private static final List<EventContract> CONTRACTS = List.of(
            contract("bid-command", "BidCommandRequested", "auctionId", "bidRequestId", "auctionId", "bidderId", "bidKind", "amount", "requestedAt"),
            contract("bid-event", "BidAccepted", "auctionId", "bidRequestId", "auctionId", "bidderId", "currentPrice", "auctionVersion", "processedAt"),
            contract("bid-event", "BidRejected", "auctionId", "bidRequestId", "auctionId", "bidderId", "reason", "auctionVersion", "processedAt"),
            contract("bid-event", "AuctionExtended", "auctionId", "auctionId", "previousEndsAt", "extendedEndsAt", "auctionVersion"),
            contract("bid-event", "AuctionEnded", "auctionId", "auctionId", "outcome", "winnerId", "finalPrice", "auctionVersion", "endedAt"),
            contract("listing-event", "ListingPublished", "productId", "productId", "sellerId", "title", "categoryId", "publishedAt", "listingVersion"),
            contract("listing-event", "ListingUpdated", "productId", "productId", "title", "categoryId", "listingVersion", "updatedAt"),
            contract("listing-event", "ListingUnpublished", "productId", "productId", "listingVersion", "unpublishedAt")
    );

    private EventContracts() {
    }

    public static List<EventContract> all() {
        return CONTRACTS;
    }

    public static Optional<EventContract> find(String topic, String eventType) {
        return CONTRACTS.stream()
                .filter(contract -> contract.topic().equals(topic) && contract.eventType().equals(eventType))
                .findFirst();
    }

    private static EventContract contract(String topic, String eventType, String partitionKeyField, String... requiredPayloadFields) {
        return new EventContract(topic, eventType, partitionKeyField, List.of(requiredPayloadFields));
    }
}
