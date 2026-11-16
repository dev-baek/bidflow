package com.bidflow.application.auction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class PrivateAuctionOutcomeTest {
    @ParameterizedTest
    @CsvSource(value = {
            "SCHEDULED, -, false, false, NOT_FINALIZED",
            "ACTIVE, -, true, true, NOT_FINALIZED",
            "CANCELLED, -, false, false, NOT_APPLICABLE",
            "ENDED, UNSOLD, false, false, NOT_APPLICABLE",
            "ENDED, SOLD, false, false, NOT_PARTICIPATED",
            "ENDED, SOLD, true, true, WON",
            "ENDED, SOLD, true, false, LOST",
    }, nullValues = "-")
    void classifiesOnlyFinalSoldAuctionsForActualParticipants(String status, String outcome, boolean accepted,
            boolean winner, PrivateAuctionOutcome expected) {
        assertThat(PrivateAuctionOutcome.classify(status, outcome, accepted, winner)).isEqualTo(expected);
    }

    @Test
    void doesNotInventAnOutcomeWhenTheFinalResultIsMissing() {
        assertThatThrownBy(() -> PrivateAuctionOutcome.classify("ENDED", null, false, false))
                .isInstanceOf(IllegalStateException.class);
    }
}
