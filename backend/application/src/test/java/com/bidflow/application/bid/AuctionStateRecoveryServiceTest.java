package com.bidflow.application.bid;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.auction.AuctionActiveStateCleaner;
import com.bidflow.domain.listing.AuctionStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AuctionStateRecoveryServiceTest {
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Test
    void rebuildsOnlyTheRequestedActiveAuctionAndItsAutomaticMaxima() {
        CapturingStates states = new CapturingStates();
        CapturingCleaner cleaner = new CapturingCleaner();
        AuctionStateRecoveryService service = new AuctionStateRecoveryService(
                auctionId -> Optional.of(snapshot(AuctionStatus.ACTIVE, NOW.plusSeconds(600))), states, cleaner);

        AuctionRecoveryResult result = service.recover(AUCTION_ID, NOW);

        assertThat(result.restored()).isTrue();
        assertThat(states.state.auctionId()).isEqualTo(AUCTION_ID);
        assertThat(states.state.currentPrice()).isEqualTo(12_000L);
        assertThat(states.maxima).containsExactly(new AutoBidMaximum(AUCTION_ID, "bidder-1", 15_000L));
        assertThat(states.ttl).isEqualTo(Duration.ofHours(24).plusMinutes(10));
        assertThat(cleaner.cleared).isEmpty();
    }

    @Test
    void clearsKeysInsteadOfRestoringAnEndedAuction() {
        CapturingStates states = new CapturingStates();
        CapturingCleaner cleaner = new CapturingCleaner();
        AuctionStateRecoveryService service = new AuctionStateRecoveryService(
                auctionId -> Optional.of(snapshot(AuctionStatus.ENDED, NOW.minusSeconds(1))), states, cleaner);

        AuctionRecoveryResult result = service.recover(AUCTION_ID, NOW);

        assertThat(result.ended()).isTrue();
        assertThat(states.state).isNull();
        assertThat(cleaner.cleared).containsExactly(AUCTION_ID);
    }

    private static AuctionRecoverySnapshot snapshot(AuctionStatus status, Instant endsAt) {
        return new AuctionRecoverySnapshot(AUCTION_ID, status, 12_000L, "bidder-1", 15_000L,
                NOW.minusSeconds(600), endsAt, 4L, List.of(new AutoBidMaximum(AUCTION_ID, "bidder-1", 15_000L)));
    }

    private static final class CapturingStates implements AuctionStateRepository {
        private AuctionRedisState state;
        private Duration ttl;
        private final List<AutoBidMaximum> maxima = new ArrayList<>();
        @Override public void save(AuctionRedisState value, Duration valueTtl) { state = value; ttl = valueTtl; }
        @Override public Optional<AuctionRedisState> findByAuctionId(UUID auctionId) { return Optional.empty(); }
        @Override public void saveAutoMaximum(UUID auctionId, String bidderId, long maximum, Duration valueTtl) {
            maxima.add(new AutoBidMaximum(auctionId, bidderId, maximum));
        }
    }

    private static final class CapturingCleaner implements AuctionActiveStateCleaner {
        private final List<UUID> cleared = new ArrayList<>();
        @Override public void clear(UUID auctionId) { cleared.add(auctionId); }
    }
}
