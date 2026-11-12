package com.bidflow.domain.bid;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class AutoBidRulesTest {
    @Test void higherMaximumWinsAtLoserMaximumPlusIncrement() {
        AutoBidResult result = AutoBidRules.resolve("seller-a", 100_000L, "seller-b", 150_000L);
        assertThat(result.winnerId()).isEqualTo("seller-b");
        assertThat(result.currentPrice()).isEqualTo(105_000L);
    }
    @Test void existingWinnerKeepsPriorityWhenMaximumsTie() {
        AutoBidResult result = AutoBidRules.resolve("seller-a", 150_000L, "seller-b", 150_000L);
        assertThat(result.winnerId()).isEqualTo("seller-a");
        assertThat(result.currentPrice()).isEqualTo(150_000L);
    }
}
