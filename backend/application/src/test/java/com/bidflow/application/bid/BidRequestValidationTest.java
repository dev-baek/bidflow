package com.bidflow.application.bid;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class BidRequestValidationTest {
    @Test void acceptsDirectAndAutomaticRequestsAtTheDomainMinimum() {
        assertThat(BidRequestValidation.validate(new BidRequestCommand(UUID.randomUUID(), "DIRECT", 1_000L))).isEqualTo(BidKind.DIRECT);
        assertThat(BidRequestValidation.validate(new BidRequestCommand(UUID.randomUUID(), "AUTO_MAX", 1_000L))).isEqualTo(BidKind.AUTO_MAX);
    }
    @Test void rejectsUnknownKindAndAmountsBelowTheDomainMinimum() {
        assertThatThrownBy(() -> BidRequestValidation.validate(new BidRequestCommand(UUID.randomUUID(), "OTHER", 1_000L))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> BidRequestValidation.validate(new BidRequestCommand(UUID.randomUUID(), "DIRECT", 999L))).isInstanceOf(IllegalArgumentException.class);
    }
}
