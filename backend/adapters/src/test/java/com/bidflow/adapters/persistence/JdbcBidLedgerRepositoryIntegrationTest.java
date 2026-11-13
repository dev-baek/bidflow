package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
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
class JdbcBidLedgerRepositoryIntegrationTest {
    private static final Instant PROCESSED_AT = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static BidLedgerRepository repository;

    @BeforeAll
    static void migrate() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        repository = new JdbcBidLedgerRepository(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)), new ObjectMapper(), UUID::randomUUID);
    }

    @Test
    void persistsAcceptedLedgerAuctionAndOutboxInOneTransaction() {
        Fixture fixture = fixture(1L);
        BidSettlementCommand command = acceptedCommand(fixture);

        assertThat(repository.persist(command)).isTrue();

        assertThat(jdbc.queryForObject("select status from bid_request where bid_request_id = ?", String.class, fixture.requestId())).isEqualTo("ACCEPTED");
        assertThat(jdbc.queryForMap("select current_price, current_winner_id, ends_at, version from auction where auction_id = ?", fixture.auctionId()))
                .containsEntry("current_price", 13_000L).containsEntry("current_winner_id", "bidder-2").containsEntry("version", 2L);
        assertThat(jdbc.queryForObject("select count(*) from bid_ledger where bid_request_id = ?", Integer.class, fixture.requestId())).isEqualTo(1);
        assertThat(jdbc.queryForMap("select topic, event_type, payload->>'currentPrice' as current_price, payload->>'isHighestBidder' as highest_bidder from outbox_event where aggregate_id = ? and event_type = 'BidAccepted'", fixture.auctionId()))
                .containsEntry("topic", "bid-event").containsEntry("event_type", "BidAccepted").containsEntry("current_price", "13000").containsEntry("highest_bidder", "true");
    }

    @Test
    void doesNotDuplicateLedgerOrOutboxEventsWhenTheSameRequestIsReplayed() {
        Fixture fixture = fixture(1L);
        BidSettlementCommand command = acceptedCommand(fixture);

        assertThat(repository.persist(command)).isTrue();
        assertThat(repository.persist(command)).isFalse();

        assertThat(jdbc.queryForObject("select count(*) from bid_ledger where bid_request_id = ?", Integer.class, fixture.requestId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and topic = 'bid-event'", Integer.class, fixture.auctionId())).isEqualTo(2);
        assertThat(jdbc.queryForObject("select current_price from auction where auction_id = ?", Long.class, fixture.auctionId())).isEqualTo(13_000L);
    }

    @Test
    void recordsRejectionWithoutChangingTheAuction() {
        Fixture fixture = fixture(1L);
        BidSettlementCommand command = new BidSettlementCommand(
                fixture.requestId(), fixture.auctionId(), "bidder-2", 12_000L,
                new DirectBidResult(DirectBidResultCode.BID_TOO_LOW, 12_000L, "bidder-1", 12_000L, PROCESSED_AT.plusSeconds(600), 1L),
                PROCESSED_AT, "correlation-1");

        assertThat(repository.persist(command)).isTrue();

        assertThat(jdbc.queryForObject("select status from bid_request where bid_request_id = ?", String.class, fixture.requestId())).isEqualTo("REJECTED");
        assertThat(jdbc.queryForMap("select decision, rejection_reason from bid_ledger where bid_request_id = ?", fixture.requestId()))
                .containsEntry("decision", "REJECTED").containsEntry("rejection_reason", "BID_TOO_LOW");
        assertThat(jdbc.queryForMap("select current_price, version from auction where auction_id = ?", fixture.auctionId()))
                .containsEntry("current_price", 12_000L).containsEntry("version", 1L);
        assertThat(jdbc.queryForObject("select event_type from outbox_event where aggregate_id = ? and topic = 'bid-event'", String.class, fixture.auctionId())).isEqualTo("BidRejected");
    }

    @Test
    void rollsBackLedgerAndOutboxWhenTheAuctionVersionDoesNotMatchTheLuaResult() {
        Fixture fixture = fixture(2L);

        assertThatThrownBy(() -> repository.persist(acceptedCommand(fixture))).isInstanceOf(IllegalStateException.class);

        assertThat(jdbc.queryForObject("select count(*) from bid_ledger where bid_request_id = ?", Integer.class, fixture.requestId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and topic = 'bid-event'", Integer.class, fixture.auctionId())).isZero();
        assertThat(jdbc.queryForObject("select status from bid_request where bid_request_id = ?", String.class, fixture.requestId())).isEqualTo("RECEIVED");
    }

    private static BidSettlementCommand acceptedCommand(Fixture fixture) {
        return new BidSettlementCommand(
                fixture.requestId(), fixture.auctionId(), "bidder-2", 13_000L,
                new DirectBidResult(DirectBidResultCode.ACCEPTED, 13_000L, "bidder-2", 13_000L, PROCESSED_AT.plusSeconds(900), 2L),
                PROCESSED_AT, "correlation-1");
    }

    private static Fixture fixture(long auctionVersion) {
        UUID productId = UUID.randomUUID();
        UUID auctionId = UUID.randomUUID();
        UUID requestId = UUID.randomUUID();
        jdbc.update("""
                insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                values (?, 'seller-1', '테스트 상품', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, ?, ?)
                """, productId, Timestamp.from(PROCESSED_AT), Timestamp.from(PROCESSED_AT));
        jdbc.update("""
                insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, starts_at, ends_at, version, created_at, updated_at)
                values (?, ?, 'seller-1', 'ACTIVE', 1000, 12000, ?, ?, ?, ?, ?)
                """, auctionId, productId, Timestamp.from(PROCESSED_AT.minusSeconds(600)), Timestamp.from(PROCESSED_AT.plusSeconds(600)), auctionVersion, Timestamp.from(PROCESSED_AT), Timestamp.from(PROCESSED_AT));
        jdbc.update("""
                insert into bid_request (bid_request_id, auction_id, bidder_id, bid_kind, amount, status, requested_at, correlation_id)
                values (?, ?, 'bidder-2', 'DIRECT', 13000, 'RECEIVED', ?, 'correlation-1')
                """, requestId, auctionId, Timestamp.from(PROCESSED_AT));
        return new Fixture(auctionId, requestId);
    }

    private record Fixture(UUID auctionId, UUID requestId) {
    }
}
