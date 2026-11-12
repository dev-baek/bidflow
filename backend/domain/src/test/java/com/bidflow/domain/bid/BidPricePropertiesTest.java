package com.bidflow.domain.bid;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Random;
import org.junit.jupiter.api.Test;

class BidPricePropertiesTest {
    @Test
    void minimumNextPriceAlwaysExceedsTheCurrentPriceAcrossDeterministicSamples() {
        Random random = new Random(66L);
        for (int sample = 0; sample < 10_000; sample++) {
            long current = 1_000L + random.nextLong(10_000_000L);

            assertThat(BidPriceRules.minimumNextPrice(current)).isGreaterThan(current);
        }
    }

    @Test
    void autoBidNeverExposesAPriceAboveTheWinningMaximum() {
        Random random = new Random(65L);
        for (int sample = 0; sample < 10_000; sample++) {
            long existingMaximum = 1_000L + random.nextLong(10_000_000L);
            long challengerMaximum = 1_000L + random.nextLong(10_000_000L);

            AutoBidResult result = AutoBidRules.resolve("existing", existingMaximum, "challenger", challengerMaximum);
            long winningMaximum = Math.max(existingMaximum, challengerMaximum);

            assertThat(result.currentPrice()).isLessThanOrEqualTo(winningMaximum);
            assertThat(result.winnerId()).isEqualTo(existingMaximum >= challengerMaximum ? "existing" : "challenger");
        }
    }
}
