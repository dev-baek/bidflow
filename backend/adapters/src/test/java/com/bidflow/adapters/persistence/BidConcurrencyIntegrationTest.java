package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.AuctionRedisKeys;
import com.bidflow.application.bid.AuctionRedisState;
import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.DirectBidCommand;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.bidflow.domain.listing.AuctionStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@Testcontainers(disabledWithoutDocker = true)
class BidConcurrencyIntegrationTest {
    private static final int REQUEST_COUNT = 1_000;
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4.5-alpine"))
            .withExposedPorts(6379);

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static LettuceConnectionFactory redisConnection;
    private static StringRedisTemplate redis;
    private static JdbcTemplate jdbc;
    private static BidLedgerRepository ledger;

    @BeforeAll
    static void setup() {
        redisConnection = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        redisConnection.afterPropertiesSet();
        redis = new StringRedisTemplate(redisConnection);
        redis.afterPropertiesSet();

        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        ledger = new JdbcBidLedgerRepository(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)), new ObjectMapper(), UUID::randomUUID);
    }

    @AfterAll
    static void closeRedisConnection() {
        if (redisConnection != null) redisConnection.destroy();
    }

    @Test
    void serializesOneThousandConcurrentDirectBidsWithoutPriceRegressionOrMultipleFinalWinners() throws Exception {
        UUID auctionId = UUID.randomUUID();
        new RedisAuctionStateRepository(redis).save(new AuctionRedisState(
                auctionId, AuctionStatus.ACTIVE, 12_000L, "", 12_000L,
                NOW.minus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(10)), 1L), Duration.ofHours(25));
        var processor = new RedisDirectBidProcessor(redis);

        List<DirectBidResult> results = concurrently(index -> processor.execute(new DirectBidCommand(
                UUID.randomUUID(), auctionId, "bidder-" + index, 13_000L + index * 1_000L, NOW)));
        List<DirectBidResult> accepted = results.stream()
                .filter(result -> result.code() == DirectBidResultCode.ACCEPTED)
                .sorted(Comparator.comparingLong(DirectBidResult::version))
                .toList();
        AuctionRedisState finalState = new RedisAuctionStateRepository(redis).findByAuctionId(auctionId).orElseThrow();

        assertThat(accepted).isNotEmpty();
        assertThat(accepted).extracting(DirectBidResult::version).doesNotHaveDuplicates();
        for (int index = 1; index < accepted.size(); index++) {
            assertThat(accepted.get(index).currentPrice()).isGreaterThan(accepted.get(index - 1).currentPrice());
        }
        assertThat(finalState.version()).isEqualTo(1L + accepted.size());
        DirectBidResult lastAccepted = accepted.getLast();
        assertThat(finalState.currentPrice()).isEqualTo(lastAccepted.currentPrice());
        assertThat(finalState.winnerId()).isEqualTo(lastAccepted.winnerId());
        assertThat(redis.opsForHash().size(AuctionRedisKeys.processed(auctionId))).isEqualTo((long) REQUEST_COUNT);
    }

    @Test
    void convergesOneThousandConcurrentSettlementRetriesToOneLedgerAndOneOutboxEvent() throws Exception {
        Fixture fixture = fixture();
        BidSettlementCommand command = new BidSettlementCommand(
                fixture.requestId(), fixture.auctionId(), "bidder-1", 13_000L,
                new DirectBidResult(DirectBidResultCode.ACCEPTED, 13_000L, "bidder-1", 13_000L, NOW.plusSeconds(600), 2L),
                NOW, "concurrency-test");

        List<Boolean> results = concurrently(ignored -> ledger.persist(command));

        assertThat(results).filteredOn(Boolean::booleanValue).hasSize(1);
        assertThat(jdbc.queryForObject("select count(*) from bid_ledger where bid_request_id = ?", Integer.class, fixture.requestId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and topic = 'bid-event'", Integer.class, fixture.auctionId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from bid_request where bid_request_id = ? and status = 'ACCEPTED'", Integer.class, fixture.requestId())).isEqualTo(1);
    }

    private static <T> List<T> concurrently(IntFunction<T> operation) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(64);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<T>> futures = new ArrayList<>();
            for (int index = 0; index < REQUEST_COUNT; index++) {
                int requestNumber = index;
                futures.add(executor.submit(() -> {
                    start.await();
                    return operation.apply(requestNumber);
                }));
            }
            start.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> future : futures) results.add(future.get(60, TimeUnit.SECONDS));
            return List.copyOf(results);
        } finally {
            executor.shutdownNow();
        }
    }

    private static Fixture fixture() {
        UUID productId = UUID.randomUUID();
        UUID auctionId = UUID.randomUUID();
        UUID requestId = UUID.randomUUID();
        jdbc.update("""
                insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                values (?, 'seller-1', '테스트 상품', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, ?, ?)
                """, productId, Timestamp.from(NOW), Timestamp.from(NOW));
        jdbc.update("""
                insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, starts_at, ends_at, version, created_at, updated_at)
                values (?, ?, 'seller-1', 'ACTIVE', 1000, 12000, ?, ?, 1, ?, ?)
                """, auctionId, productId, Timestamp.from(NOW.minusSeconds(600)), Timestamp.from(NOW.plusSeconds(600)), Timestamp.from(NOW), Timestamp.from(NOW));
        jdbc.update("""
                insert into bid_request (bid_request_id, auction_id, bidder_id, bid_kind, amount, status, requested_at, correlation_id)
                values (?, ?, 'bidder-1', 'DIRECT', 13000, 'RECEIVED', ?, 'concurrency-test')
                """, requestId, auctionId, Timestamp.from(NOW));
        return new Fixture(auctionId, requestId);
    }

    private record Fixture(UUID auctionId, UUID requestId) {
    }
}
