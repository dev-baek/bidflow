package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class JdbcAuctionDetailSnapshotReaderIntegrationTest {
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static JdbcAuctionDetailSnapshotReader reader;

    @BeforeAll
    static void setup() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        reader = new JdbcAuctionDetailSnapshotReader(jdbc);
    }

    @Test
    void readsEndedAuctionAndItsPublicResultWithoutWinnerIdentity() {
        UUID auctionId = fixture();
        jdbc.update("insert into auction_result (auction_id, outcome, winner_id, final_price, determined_at) values (?, 'SOLD', 'secret-winner', 21000, ?)", auctionId, Timestamp.from(NOW));

        var snapshot = reader.findByAuctionId(auctionId).orElseThrow();

        assertThat(snapshot.title()).isEqualTo("테스트 카메라");
        assertThat(snapshot.thumbnailObjectKey()).isEqualTo("products/camera.jpg");
        assertThat(snapshot.currentPrice()).isEqualTo(21_000);
        assertThat(snapshot.status()).isEqualTo("ENDED");
        assertThat(snapshot.outcome()).isEqualTo("SOLD");
        assertThat(snapshot.finalPrice()).isEqualTo(21_000L);
    }

    @Test
    void returnsEmptyForUnknownAuction() {
        assertThat(reader.findByAuctionId(UUID.randomUUID())).isEmpty();
    }

    private static UUID fixture() {
        UUID productId = UUID.randomUUID();
        UUID auctionId = UUID.randomUUID();
        jdbc.update("""
                insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                values (?, 'seller', '테스트 카메라', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, ?, ?)
                """,
                productId, Timestamp.from(NOW), Timestamp.from(NOW));
        jdbc.update("insert into product_image (image_id, product_id, object_key, display_order, created_at) values (?, ?, 'products/camera.jpg', 0, ?)", UUID.randomUUID(), productId, Timestamp.from(NOW));
        jdbc.update("""
                insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, current_winner_id, starts_at, ends_at, version, created_at, updated_at)
                values (?, ?, 'seller', 'ENDED', 10000, 21000, 'secret-winner', ?, ?, 7, ?, ?)
                """,
                auctionId, productId, Timestamp.from(NOW.minusSeconds(600)), Timestamp.from(NOW), Timestamp.from(NOW), Timestamp.from(NOW));
        return auctionId;
    }
}
