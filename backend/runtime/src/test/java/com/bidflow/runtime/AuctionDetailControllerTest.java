package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.auction.AuctionDetailSnapshot;
import com.bidflow.application.auction.AuctionDetailSnapshotReader;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class AuctionDetailControllerTest {
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    void returnsOnlyPublicSnapshotFields() {
        AuctionDetailSnapshot snapshot = new AuctionDetailSnapshot(AUCTION_ID, "camera", true, 21_000,
                Instant.parse("2030-01-01T12:00:00Z"), "ENDED", 7, "SOLD", 21_000L);
        AuctionDetailController controller = new AuctionDetailController(id -> Optional.of(snapshot));

        var response = controller.get(AUCTION_ID);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(new AuctionDetailController.Response(
                AUCTION_ID, "camera", true, 21_000, Instant.parse("2030-01-01T12:00:00Z"),
                "ENDED", 7, "SOLD", 21_000L));
    }

    @Test
    void returnsNotFoundWhenSnapshotDoesNotExist() {
        AuctionDetailSnapshotReader snapshots = id -> Optional.empty();

        var response = new AuctionDetailController(snapshots).get(AUCTION_ID);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isEqualTo(new AuctionDetailController.Error("AUCTION_NOT_FOUND"));
    }
}
