package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.auction.AuctionCloseRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class JdbcAuctionCloseRepositoryIntegrationTest {
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static AuctionCloseRepository firstWorker;
    private static AuctionCloseRepository secondWorker;

    @BeforeAll
    static void setup() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        firstWorker = new JdbcAuctionCloseRepository(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)), new ObjectMapper(), UUID::randomUUID);
        secondWorker = new JdbcAuctionCloseRepository(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)), new ObjectMapper(), UUID::randomUUID);
    }

    @Test
    void letsOnlyOneOfTwoWorkersCloseAnExpiredAuctionAndCreateItsResultAndOutbox() throws Exception {
        UUID auctionId = fixture(NOW.minusSeconds(1), "bidder-1");
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Integer>> results = List.of(
                    executor.submit(() -> { start.await(); return firstWorker.closeExpired(NOW, 10); }),
                    executor.submit(() -> { start.await(); return secondWorker.closeExpired(NOW, 10); }));
            start.countDown();

            assertThat(results.stream().mapToInt(future -> get(future)).sum()).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }

        assertThat(jdbc.queryForObject("select status from auction where auction_id = ?", String.class, auctionId)).isEqualTo("ENDED");
        assertThat(jdbc.queryForMap("select outcome, winner_id, final_price from auction_result where auction_id = ?", auctionId))
                .containsEntry("outcome", "SOLD").containsEntry("winner_id", "bidder-1").containsEntry("final_price", 13_000L);
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and event_type = 'AuctionEnded'", Integer.class, auctionId)).isEqualTo(1);
    }

    @Test
    void doesNotCloseAnAuctionWhoseLatestEndTimeWasExtended() {
        UUID auctionId = fixture(NOW.plusSeconds(1), "bidder-1");

        assertThat(firstWorker.closeExpired(NOW, 10)).isZero();
        assertThat(jdbc.queryForObject("select status from auction where auction_id = ?", String.class, auctionId)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select count(*) from auction_result where auction_id = ?", Integer.class, auctionId)).isZero();
    }

    @Test
    void recordsUnsoldWhenThereIsNoCurrentWinner() {
        UUID auctionId = fixture(NOW.minusSeconds(1), null);

        assertThat(firstWorker.closeExpired(NOW, 10)).isEqualTo(1);
        assertThat(jdbc.queryForMap("select outcome, winner_id, final_price from auction_result where auction_id = ?", auctionId))
                .containsEntry("outcome", "UNSOLD").containsEntry("winner_id", null).containsEntry("final_price", null);
    }

    private static int get(Future<Integer> future) {
        try { return future.get(10, TimeUnit.SECONDS); }
        catch (Exception exception) { throw new IllegalStateException(exception); }
    }

    private static UUID fixture(Instant endsAt, String winnerId) {
        UUID productId = UUID.randomUUID();
        UUID auctionId = UUID.randomUUID();
        jdbc.update("""
                insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                values (?, 'seller-1', '테스트 상품', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, ?, ?)
                """, productId, Timestamp.from(NOW), Timestamp.from(NOW));
        jdbc.update("""
                insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, current_winner_id, starts_at, ends_at, version, created_at, updated_at)
                values (?, ?, 'seller-1', 'ACTIVE', 1000, 13000, ?, ?, ?, 4, ?, ?)
                """, auctionId, productId, winnerId, Timestamp.from(NOW.minusSeconds(600)), Timestamp.from(endsAt), Timestamp.from(NOW), Timestamp.from(NOW));
        return auctionId;
    }
}
