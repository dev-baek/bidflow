package com.bidflow.domain.listing;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ListingAuctionRulesTest {
    private static final Instant NOW = Instant.parse("2026-11-12T00:00:00Z");
    private static final UUID PRODUCT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final String SELLER_ID = "seller-1";

    @Test
    void acceptsProductAtMinimumFieldAndImageBoundaries() {
        ProductDraft draft = new ProductDraft(
                "  상품  ",
                "  충분한 설명입니다.  ",
                "DIGITAL",
                ConditionGrade.GOOD,
                List.of("products/1/cover.jpg")
        );

        RuleResult<ProductDraft, ProductViolation> result = ListingAuctionRules.validateProduct(draft);

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.value().orElseThrow().title()).isEqualTo("상품");
        assertThat(result.value().orElseThrow().description()).isEqualTo("충분한 설명입니다.");
    }

    @Test
    void rejectsProductFieldsOutsideBoundaries() {
        ProductDraft draft = new ProductDraft(
                " ",
                "짧음",
                " ",
                ConditionGrade.GOOD,
                List.of()
        );

        RuleResult<ProductDraft, ProductViolation> result = ListingAuctionRules.validateProduct(draft);

        assertThat(result.isSuccess()).isFalse();
        assertThat(result.violations()).containsExactlyInAnyOrder(
                ProductViolation.TITLE_LENGTH,
                ProductViolation.DESCRIPTION_LENGTH,
                ProductViolation.CATEGORY_REQUIRED,
                ProductViolation.IMAGE_COUNT
        );
    }

    @Test
    void createsScheduledAuctionAtExactTimeAndPriceBoundaries() {
        AuctionDraft draft = new AuctionDraft(
                AUCTION_ID,
                PRODUCT_ID,
                SELLER_ID,
                1_000L,
                NOW.plus(Duration.ofMinutes(10)),
                NOW.plus(Duration.ofMinutes(20))
        );

        RuleResult<Auction, AuctionViolation> result = ListingAuctionRules.createAuction(ProductStatus.PUBLISHED, draft, NOW);

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.value().orElseThrow()).isEqualTo(new Auction(
                AUCTION_ID,
                PRODUCT_ID,
                SELLER_ID,
                AuctionStatus.SCHEDULED,
                1_000L,
                1_000L,
                NOW.plus(Duration.ofMinutes(10)),
                NOW.plus(Duration.ofMinutes(20)),
                1L
        ));
    }

    @Test
    void rejectsAuctionOutsidePriceAndPeriodBoundaries() {
        AuctionDraft draft = new AuctionDraft(
                AUCTION_ID,
                PRODUCT_ID,
                SELLER_ID,
                999L,
                NOW.plus(Duration.ofMinutes(9)).plusSeconds(59),
                NOW.plus(Duration.ofDays(14)).plus(Duration.ofMinutes(11))
        );

        RuleResult<Auction, AuctionViolation> result = ListingAuctionRules.createAuction(ProductStatus.PUBLISHED, draft, NOW);

        assertThat(result.isSuccess()).isFalse();
        assertThat(result.violations()).containsExactlyInAnyOrder(
                AuctionViolation.STARTING_PRICE_TOO_LOW,
                AuctionViolation.STARTS_TOO_SOON,
                AuctionViolation.PERIOD_TOO_LONG
        );
    }

    @Test
    void rejectsAuctionForUnpublishedProductAndShortPeriod() {
        AuctionDraft draft = new AuctionDraft(
                AUCTION_ID,
                PRODUCT_ID,
                SELLER_ID,
                1_000L,
                NOW.plus(Duration.ofMinutes(10)),
                NOW.plus(Duration.ofMinutes(19)).plusSeconds(59)
        );

        RuleResult<Auction, AuctionViolation> result = ListingAuctionRules.createAuction(ProductStatus.UNPUBLISHED, draft, NOW);

        assertThat(result.violations()).containsExactlyInAnyOrder(
                AuctionViolation.PRODUCT_NOT_PUBLISHED,
                AuctionViolation.PERIOD_TOO_SHORT
        );
    }

    @Test
    void activatesAndEndsAtExactBoundaryInstantsWithoutMutatingInput() {
        Auction scheduled = scheduledAuction(NOW.plus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(20)));

        RuleResult<Auction, AuctionViolation> activated = ListingAuctionRules.transition(
                scheduled,
                AuctionTransition.ACTIVATE,
                SELLER_ID,
                scheduled.startsAt()
        );
        Auction active = activated.value().orElseThrow();
        RuleResult<Auction, AuctionViolation> ended = ListingAuctionRules.transition(
                active,
                AuctionTransition.END,
                SELLER_ID,
                active.endsAt()
        );

        assertThat(activated.isSuccess()).isTrue();
        assertThat(active.status()).isEqualTo(AuctionStatus.ACTIVE);
        assertThat(active.version()).isEqualTo(2L);
        assertThat(scheduled.status()).isEqualTo(AuctionStatus.SCHEDULED);
        assertThat(ended.value().orElseThrow().status()).isEqualTo(AuctionStatus.ENDED);
        assertThat(ended.value().orElseThrow().version()).isEqualTo(3L);
    }

    @Test
    void rejectsStateTransitionsBeforeTheirTimeBoundary() {
        Auction scheduled = scheduledAuction(NOW.plus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(20)));
        Auction active = activeAuction(NOW.plus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(20)));

        RuleResult<Auction, AuctionViolation> activation = ListingAuctionRules.transition(
                scheduled,
                AuctionTransition.ACTIVATE,
                SELLER_ID,
                scheduled.startsAt().minusMillis(1)
        );
        RuleResult<Auction, AuctionViolation> ending = ListingAuctionRules.transition(
                active,
                AuctionTransition.END,
                SELLER_ID,
                active.endsAt().minusMillis(1)
        );

        assertThat(activation.violations()).containsExactly(AuctionViolation.NOT_STARTED);
        assertThat(ending.violations()).containsExactly(AuctionViolation.NOT_ENDED);
    }

    @Test
    void allowsOnlyOwnerToCancelBeforeStart() {
        Auction scheduled = scheduledAuction(NOW.plus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(20)));

        RuleResult<Auction, AuctionViolation> cancelled = ListingAuctionRules.transition(
                scheduled,
                AuctionTransition.CANCEL,
                SELLER_ID,
                NOW
        );
        RuleResult<Auction, AuctionViolation> foreignCancel = ListingAuctionRules.transition(
                scheduled,
                AuctionTransition.CANCEL,
                "another-seller",
                NOW
        );
        RuleResult<Auction, AuctionViolation> lateCancel = ListingAuctionRules.transition(
                scheduled,
                AuctionTransition.CANCEL,
                SELLER_ID,
                scheduled.startsAt()
        );

        assertThat(cancelled.value().orElseThrow().status()).isEqualTo(AuctionStatus.CANCELLED);
        assertThat(foreignCancel.violations()).containsExactly(AuctionViolation.CANCEL_NOT_OWNER);
        assertThat(lateCancel.violations()).containsExactly(AuctionViolation.AUCTION_ALREADY_STARTED);
    }

    @Test
    void extendsOnlyNewlyAcceptedBidWithLessThanFiveMinutesRemaining() {
        Auction active = activeAuction(NOW.minus(Duration.ofHours(1)), NOW.plus(Duration.ofMinutes(4)).plusSeconds(59));

        AuctionExtension extension = ListingAuctionRules.extendEndsAtAfterAcceptedBid(active, true, NOW);
        AuctionExtension exactBoundary = ListingAuctionRules.extendEndsAtAfterAcceptedBid(
                activeAuction(NOW.minus(Duration.ofHours(1)), NOW.plus(Duration.ofMinutes(5))),
                true,
                NOW
        );
        AuctionExtension rejected = ListingAuctionRules.extendEndsAtAfterAcceptedBid(active, false, NOW);

        assertThat(extension.extended()).isTrue();
        assertThat(extension.auction().endsAt()).isEqualTo(active.endsAt().plus(Duration.ofMinutes(5)));
        assertThat(extension.auction().version()).isEqualTo(2L);
        assertThat(exactBoundary.extended()).isFalse();
        assertThat(rejected.extended()).isFalse();
    }

    private static Auction scheduledAuction(Instant startsAt, Instant endsAt) {
        return new Auction(AUCTION_ID, PRODUCT_ID, SELLER_ID, AuctionStatus.SCHEDULED, 1_000L, 1_000L, startsAt, endsAt, 1L);
    }

    private static Auction activeAuction(Instant startsAt, Instant endsAt) {
        return new Auction(AUCTION_ID, PRODUCT_ID, SELLER_ID, AuctionStatus.ACTIVE, 1_000L, 1_000L, startsAt, endsAt, 1L);
    }
}
