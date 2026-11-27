package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.bid.AutoBidMaximum;
import com.bidflow.application.bid.AutoBidMaximumRepository;
import com.bidflow.application.bid.AuctionRecoverySnapshot;
import com.bidflow.application.bid.AuctionRecoverySnapshotRepository;
import com.bidflow.application.bid.AuctionStateRecoveryService;
import com.bidflow.application.bid.AutoBidCommand;
import com.bidflow.application.bid.BidRequestCommand;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.DirectBidCommand;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Tag("integration")
@Testcontainers(disabledWithoutDocker = true)
class JdbcAuctionRecoverySnapshotRepositoryIntegrationTest {
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");
    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7.4-alpine").withExposedPorts(6379);

    private static JdbcTemplate jdbc;
    private static AutoBidMaximumRepository maxima;
    private static AuctionRecoverySnapshotRepository snapshots;
    private static LettuceConnectionFactory connection;
    private static StringRedisTemplate redis;
    private static TransactionTemplate transaction;
    private static UUID legacyAuctionId;

    @BeforeAll
    static void setup() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").target(MigrationVersion.fromVersion("9")).load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        legacyAuctionId = fixture();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        maxima = new JdbcAutoBidMaximumRepository(jdbc, Clock.fixed(NOW, ZoneOffset.UTC));
        snapshots = new JdbcAuctionRecoverySnapshotRepository(jdbc);
        transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        connection = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        connection.afterPropertiesSet();
        redis = new StringRedisTemplate(connection);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void closeRedis() { if (connection != null) connection.destroy(); }

    @ParameterizedTest
    @ValueSource(longs = {15_000L, 50_000L})
    void replaysIdenticalNextBidAfterRecoveryRegardlessOfTheWinnersOldAutomaticMaximum(long oldMaximum) {
        DirectBidResult uninterrupted = nextBid(oldMaximum, false);
        assertThat(uninterrupted.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(uninterrupted.currentPrice()).isEqualTo(26_000L);
        assertThat(nextBid(oldMaximum, true)).as("historical maximum %s", oldMaximum).isEqualTo(uninterrupted);
    }

    @Test
    void migrationPreservesTheLegacyPriceButDoesNotGuessAnActiveWinnersMaximum() {
        maxima.save(new AutoBidMaximum(legacyAuctionId, "bidder-1", 50_000L));
        var snapshot = snapshots.findByAuctionId(legacyAuctionId).orElseThrow();
        assertThat(snapshot.currentPrice()).isEqualTo(13_000L);
        assertThat(snapshot.winnerId()).isEqualTo("bidder-1");
        assertThat(snapshot.winnerMaximum()).isNull();
        var states = new RedisAuctionStateRepository(redis);
        var recovery = new AuctionStateRecoveryService(snapshots, states, new RedisAuctionActiveStateCleaner(redis));

        assertThatThrownBy(() -> recovery.recover(legacyAuctionId, NOW)).isInstanceOf(IllegalStateException.class);
        assertThat(states.findByAuctionId(legacyAuctionId)).isEmpty();
        assertThat(recovery.recover(legacyAuctionId, snapshot.endsAt()).ended()).isTrue();
        assertThat(states.findByAuctionId(legacyAuctionId)).isEmpty();
    }

    private static DirectBidResult nextBid(long oldMaximum, boolean loseRedis) {
        UUID auctionId = fixture();
        jdbc.update("update auction set current_price = 12000, current_winner_id = null where auction_id = ?", auctionId);
        var cleaner = new RedisAuctionActiveStateCleaner(redis);
        var recovery = new AuctionStateRecoveryService(snapshots, new RedisAuctionStateRepository(redis), cleaner);
        recovery.recover(auctionId, NOW);
        settle(auctionId, "bidder-1", oldMaximum, "AUTO_MAX");
        settle(auctionId, "bidder-2", 14_000L, "DIRECT");
        settle(auctionId, "bidder-1", 25_000L, "DIRECT");
        if (loseRedis) {
            cleaner.clear(auctionId);
            recovery.recover(auctionId, NOW);
        }
        return settle(auctionId, "bidder-3", 30_000L, "AUTO_MAX");
    }

    private static DirectBidResult settle(UUID auctionId, String bidder, long amount, String kind) {
        UUID requestId = UUID.randomUUID();
        new JdbcBidRequestRepository(jdbc, transaction).saveIfAbsent(bidder, requestId.toString(), "a".repeat(64),
                "recovery-test", requestId, new BidRequestCommand(auctionId, kind, amount));
        boolean automatic = kind.equals("AUTO_MAX");
        var result = automatic
                ? new RedisAutoBidProcessor(redis).execute(new AutoBidCommand(requestId, auctionId, bidder, amount, NOW))
                : new RedisDirectBidProcessor(redis).execute(new DirectBidCommand(requestId, auctionId, bidder, amount, NOW));
        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        transaction.executeWithoutResult(ignored -> {
            assertThat(new JdbcBidLedgerRepository(jdbc, transaction, new ObjectMapper(), UUID::randomUUID)
                    .persist(new BidSettlementCommand(requestId, auctionId, bidder, amount, result, NOW, "recovery-test"))).isTrue();
            if (automatic) maxima.save(new AutoBidMaximum(auctionId, bidder, amount));
        });
        return result;
    }

    @Test
    void readsTheDurableAuctionAndAutomaticMaximaNeededForOneRedisRecovery() {
        UUID auctionId = fixture();
        jdbc.update("update auction set effective_winner_maximum = 17000 where auction_id = ?", auctionId);
        maxima.save(new AutoBidMaximum(auctionId, "bidder-1", 15_000L));
        maxima.save(new AutoBidMaximum(auctionId, "bidder-1", 14_000L));
        maxima.save(new AutoBidMaximum(auctionId, "bidder-2", 12_000L));

        AuctionRecoverySnapshot snapshot = snapshots.findByAuctionId(auctionId).orElseThrow();

        assertThat(snapshot.currentPrice()).isEqualTo(13_000L);
        assertThat(snapshot.winnerId()).isEqualTo("bidder-1");
        assertThat(snapshot.winnerMaximum()).isEqualTo(17_000L);
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
