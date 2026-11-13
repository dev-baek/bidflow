package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.AutoBidMaximum;
import com.bidflow.application.bid.AutoBidMaximumRepository;
import com.bidflow.application.bid.AuctionRecoverySnapshot;
import com.bidflow.application.bid.AuctionRecoverySnapshotRepository;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class JdbcAuctionRecoverySnapshotRepositoryIntegrationTest {
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static AutoBidMaximumRepository maxima;
    private static AuctionRecoverySnapshotRepository snapshots;

    @BeforeAll
    static void setup() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        maxima = new JdbcAutoBidMaximumRepository(jdbc, Clock.fixed(NOW, ZoneOffset.UTC));
        snapshots = new JdbcAuctionRecoverySnapshotRepository(jdbc);
    }

    @Test
    void readsTheDurableAuctionAndAutomaticMaximaNeededForOneRedisRecovery() {
        UUID auctionId = fixture();
        maxima.save(new AutoBidMaximum(auctionId, "bidder-1", 15_000L));
        maxima.save(new AutoBidMaximum(auctionId, "bidder-1", 14_000L));
        maxima.save(new AutoBidMaximum(auctionId, "bidder-2", 12_000L));

        AuctionRecoverySnapshot snapshot = snapshots.findByAuctionId(auctionId).orElseThrow();

        assertThat(snapshot.currentPrice()).isEqualTo(13_000L);
        assertThat(snapshot.winnerId()).isEqualTo("bidder-1");
        assertThat(snapshot.winnerMaximum()).isEqualTo(15_000L);
        assertThat(snapshot.automaticMaxima()).containsExactlyInAnyOrder(
                new AutoBidMaximum(auctionId, "bidder-1", 15_000L), new AutoBidMaximum(auctionId, "bidder-2", 12_000L));
    }

    private static UUID fixture() {
        UUID productId = UUID.randomUUID();
        UUID auctionId = UUID.randomUUID();
        jdbc.update("""
                insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                values (?, 'seller-1', '테스트 상품', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, ?, ?)
                """, productId, Timestamp.from(NOW), Timestamp.from(NOW));
        jdbc.update("""
                insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, current_winner_id, starts_at, ends_at, version, created_at, updated_at)
                values (?, ?, 'seller-1', 'ACTIVE', 1000, 13000, 'bidder-1', ?, ?, 4, ?, ?)
                """, auctionId, productId, Timestamp.from(NOW.minusSeconds(600)), Timestamp.from(NOW.plusSeconds(600)), Timestamp.from(NOW), Timestamp.from(NOW));
        return auctionId;
    }
}
