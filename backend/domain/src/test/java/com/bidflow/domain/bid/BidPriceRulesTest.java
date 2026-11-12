package com.bidflow.domain.bid;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class BidPriceRulesTest {
    @Test
    void calculatesTheMinimumIncrementAtEveryPriceBoundary() {
        assertThat(BidPriceRules.incrementFor(1_000L)).isEqualTo(1_000L);
        assertThat(BidPriceRules.incrementFor(99_999L)).isEqualTo(1_000L);
        assertThat(BidPriceRules.incrementFor(100_000L)).isEqualTo(5_000L);
        assertThat(BidPriceRules.incrementFor(499_999L)).isEqualTo(5_000L);
        assertThat(BidPriceRules.incrementFor(500_000L)).isEqualTo(10_000L);
        assertThat(BidPriceRules.incrementFor(999_999L)).isEqualTo(10_000L);
        assertThat(BidPriceRules.incrementFor(1_000_000L)).isEqualTo(50_000L);
    }

    @Test
    void calculatesTheNextMinimumBidWithoutFloatingPointArithmetic() {
        assertThat(BidPriceRules.minimumNextPrice(99_999L)).isEqualTo(100_999L);
        assertThat(BidPriceRules.minimumNextPrice(100_000L)).isEqualTo(105_000L);
    }

    @Test
    void rejectsAPriceBelowTheDomainMinimum() {
        assertThatThrownBy(() -> BidPriceRules.incrementFor(999L)).isInstanceOf(IllegalArgumentException.class);
    }
}
