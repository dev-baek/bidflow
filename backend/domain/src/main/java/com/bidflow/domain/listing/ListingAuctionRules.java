package com.bidflow.domain.listing;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public final class ListingAuctionRules {
    private static final int MIN_TITLE_LENGTH = 2;
    private static final int MAX_TITLE_LENGTH = 100;
    private static final int MIN_DESCRIPTION_LENGTH = 10;
    private static final int MAX_DESCRIPTION_LENGTH = 5_000;
    private static final int MIN_IMAGE_COUNT = 1;
    private static final int MAX_IMAGE_COUNT = 10;
    private static final long MIN_STARTING_PRICE = 1_000L;
    private static final Duration MIN_START_DELAY = Duration.ofMinutes(10);
    private static final Duration MIN_AUCTION_PERIOD = Duration.ofMinutes(10);
    private static final Duration MAX_AUCTION_PERIOD = Duration.ofDays(14);
    private static final Duration EXTENSION_THRESHOLD = Duration.ofMinutes(5);

    private ListingAuctionRules() {
    }

    public static RuleResult<ProductDraft, ProductViolation> validateProduct(ProductDraft draft) {
        Objects.requireNonNull(draft, "draft must not be null");
        String title = normalize(draft.title());
        String description = normalize(draft.description());
        String categoryId = normalize(draft.categoryId());
        List<ProductViolation> violations = new ArrayList<>();

        if (title.length() < MIN_TITLE_LENGTH || title.length() > MAX_TITLE_LENGTH) {
            violations.add(ProductViolation.TITLE_LENGTH);
        }
        if (description.length() < MIN_DESCRIPTION_LENGTH || description.length() > MAX_DESCRIPTION_LENGTH) {
            violations.add(ProductViolation.DESCRIPTION_LENGTH);
        }
        if (categoryId.isEmpty()) {
            violations.add(ProductViolation.CATEGORY_REQUIRED);
        }
        if (draft.conditionGrade() == null) {
            violations.add(ProductViolation.CONDITION_REQUIRED);
        }
        if (draft.imageObjectKeys().size() < MIN_IMAGE_COUNT || draft.imageObjectKeys().size() > MAX_IMAGE_COUNT) {
            violations.add(ProductViolation.IMAGE_COUNT);
        }
        if (draft.imageObjectKeys().stream().anyMatch(ListingAuctionRules::isBlank)) {
            violations.add(ProductViolation.IMAGE_KEY_REQUIRED);
        }
        if (!violations.isEmpty()) {
            return RuleResult.failure(violations);
        }

        return RuleResult.success(new ProductDraft(title, description, categoryId, draft.conditionGrade(), draft.imageObjectKeys()));
    }

    public static RuleResult<Auction, AuctionViolation> createAuction(
            ProductStatus productStatus,
            AuctionDraft draft,
            Instant now
    ) {
        Objects.requireNonNull(draft, "draft must not be null");
        List<AuctionViolation> violations = new ArrayList<>();
        if (productStatus != ProductStatus.PUBLISHED) {
            violations.add(AuctionViolation.PRODUCT_NOT_PUBLISHED);
        }
        if (draft.auctionId() == null || draft.productId() == null || isBlank(draft.sellerId()) || draft.startsAt() == null || draft.endsAt() == null || now == null) {
            violations.add(AuctionViolation.REQUIRED_FIELD_MISSING);
            return RuleResult.failure(violations);
        }
        if (draft.startingPrice() < MIN_STARTING_PRICE) {
            violations.add(AuctionViolation.STARTING_PRICE_TOO_LOW);
        }
        if (draft.startsAt().isBefore(now.plus(MIN_START_DELAY))) {
            violations.add(AuctionViolation.STARTS_TOO_SOON);
        }

        Duration period = Duration.between(draft.startsAt(), draft.endsAt());
        if (period.compareTo(MIN_AUCTION_PERIOD) < 0) {
            violations.add(AuctionViolation.PERIOD_TOO_SHORT);
        }
        if (period.compareTo(MAX_AUCTION_PERIOD) > 0) {
            violations.add(AuctionViolation.PERIOD_TOO_LONG);
        }
        if (!violations.isEmpty()) {
            return RuleResult.failure(violations);
        }

        return RuleResult.success(new Auction(
                draft.auctionId(),
                draft.productId(),
                draft.sellerId(),
                AuctionStatus.SCHEDULED,
                draft.startingPrice(),
                draft.startingPrice(),
                draft.startsAt(),
                draft.endsAt(),
                1L
        ));
    }

    public static RuleResult<Auction, AuctionViolation> transition(
            Auction auction,
            AuctionTransition transition,
            String actorId,
            Instant now
    ) {
        if (auction == null || transition == null || now == null) {
            return RuleResult.failure(List.of(AuctionViolation.REQUIRED_FIELD_MISSING));
        }

        return switch (transition) {
            case ACTIVATE -> activate(auction, now);
            case END -> end(auction, now);
            case CANCEL -> cancel(auction, actorId, now);
        };
    }

    public static AuctionExtension extendEndsAtAfterAcceptedBid(Auction auction, boolean newlyAccepted, Instant approvedAt) {
        Objects.requireNonNull(auction, "auction must not be null");
        Objects.requireNonNull(approvedAt, "approvedAt must not be null");
        if (!newlyAccepted || auction.status() != AuctionStatus.ACTIVE || !approvedAt.isBefore(auction.endsAt())) {
            return new AuctionExtension(auction, false);
        }

        Duration remaining = Duration.between(approvedAt, auction.endsAt());
        if (remaining.compareTo(EXTENSION_THRESHOLD) >= 0) {
            return new AuctionExtension(auction, false);
        }

        return new AuctionExtension(withState(auction, auction.status(), auction.endsAt().plus(EXTENSION_THRESHOLD)), true);
    }

    private static RuleResult<Auction, AuctionViolation> activate(Auction auction, Instant now) {
        if (auction.status() != AuctionStatus.SCHEDULED) {
            return RuleResult.failure(List.of(AuctionViolation.ILLEGAL_TRANSITION));
        }
        if (now.isBefore(auction.startsAt())) {
            return RuleResult.failure(List.of(AuctionViolation.NOT_STARTED));
        }
        return RuleResult.success(withState(auction, AuctionStatus.ACTIVE, auction.endsAt()));
    }

    private static RuleResult<Auction, AuctionViolation> end(Auction auction, Instant now) {
        if (auction.status() != AuctionStatus.ACTIVE) {
            return RuleResult.failure(List.of(AuctionViolation.ILLEGAL_TRANSITION));
        }
        if (now.isBefore(auction.endsAt())) {
            return RuleResult.failure(List.of(AuctionViolation.NOT_ENDED));
        }
        return RuleResult.success(withState(auction, AuctionStatus.ENDED, auction.endsAt()));
    }

    private static RuleResult<Auction, AuctionViolation> cancel(Auction auction, String actorId, Instant now) {
        if (auction.status() != AuctionStatus.SCHEDULED) {
            return RuleResult.failure(List.of(AuctionViolation.ILLEGAL_TRANSITION));
        }
        if (!auction.sellerId().equals(actorId)) {
            return RuleResult.failure(List.of(AuctionViolation.CANCEL_NOT_OWNER));
        }
        if (!now.isBefore(auction.startsAt())) {
            return RuleResult.failure(List.of(AuctionViolation.AUCTION_ALREADY_STARTED));
        }
        return RuleResult.success(withState(auction, AuctionStatus.CANCELLED, auction.endsAt()));
    }

    private static Auction withState(Auction auction, AuctionStatus status, Instant endsAt) {
        return new Auction(
                auction.auctionId(),
                auction.productId(),
                auction.sellerId(),
                status,
                auction.startingPrice(),
                auction.currentPrice(),
                auction.startsAt(),
                endsAt,
                auction.version() + 1
        );
    }

    private static String normalize(String value) {
        return value == null ? "" : value.strip();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
