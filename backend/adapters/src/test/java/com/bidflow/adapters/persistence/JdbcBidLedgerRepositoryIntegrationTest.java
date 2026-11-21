package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidRequestCommand;
import com.bidflow.application.bid.BidRequestIdempotencyService;
import com.bidflow.application.bid.BidRequestPayloadMismatchException;
import com.bidflow.application.bid.BidRequestRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.auction.AuctionCloseRepository;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Tag("integration")
@Testcontainers(disabledWithoutDocker = true)
class JdbcBidLedgerRepositoryIntegrationTest {
    private static final Instant PROCESSED_AT = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static BidLedgerRepository repository;
    private static BidRequestRepository bidRequests;

    @BeforeAll
    static void migrate() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        repository = new JdbcBidLedgerRepository(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)), new ObjectMapper(), UUID::randomUUID);
        bidRequests = new JdbcBidRequestRepository(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
    }

    @Test
    void persistsReceivedBidRequestAndCommandOutboxEvent() {
        Fixture fixture = fixture(1L);
        UUID requestId = UUID.randomUUID();

        bidRequests.saveIfAbsent("bidder-3", "request-key-1", "a".repeat(64), "correlation-2", requestId,
                new BidRequestCommand(fixture.auctionId(), "AUTO_MAX", 30_000L));

        assertThat(jdbc.queryForMap("select bidder_id, bid_kind, amount, status from bid_request where bid_request_id = ?", requestId))
                .containsEntry("bidder_id", "bidder-3").containsEntry("bid_kind", "AUTO_MAX")
                .containsEntry("amount", 30_000L).containsEntry("status", "RECEIVED");
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and event_type = 'BidCommandRequested'",
                Integer.class, fixture.auctionId())).isEqualTo(1);
    }

    @Test
    void concurrentFirstReceiptsAndOneHundredRetriesShareOneRequestAndCommand() throws Exception {
        Fixture fixture = fixture(1L);
        String bidder = "bidder-concurrent";
        String key = fixture.auctionId().toString();
        var command = new BidRequestCommand(fixture.auctionId(), "DIRECT", 15_000L);
        var start = new CyclicBarrier(8);
        var initial = new BidRequestIdempotencyService(bidRequests, () -> {
            try {
                // Make every first caller reach the insert after a PostgreSQL lookup miss.
                start.await(10, TimeUnit.SECONDS);
                return UUID.randomUUID();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError(exception);
            } catch (Exception exception) {
                throw new AssertionError(exception);
            }
        });

        UUID requestId;
        try (var workers = Executors.newFixedThreadPool(8)) {
            var receipts = new ArrayList<Future<UUID>>();
            for (int index = 0; index < 8; index++) {
                receipts.add(workers.submit(() -> initial.receive(bidder, key, "initial", command)));
            }
            requestId = receipts.getFirst().get(15, TimeUnit.SECONDS);
            for (var receipt : receipts) assertThat(receipt.get(15, TimeUnit.SECONDS)).isEqualTo(requestId);

            var retries = new BidRequestIdempotencyService(bidRequests, UUID::randomUUID);
            receipts.clear();
            for (int index = 0; index < 100; index++) {
                receipts.add(workers.submit(() -> retries.receive(bidder, key, "retry", command)));
            }
            for (var receipt : receipts) assertThat(receipt.get(15, TimeUnit.SECONDS)).isEqualTo(requestId);
        }

        var service = new BidRequestIdempotencyService(bidRequests, UUID::randomUUID);
        assertThatThrownBy(() -> service.receive(bidder, key, "mismatch",
                new BidRequestCommand(fixture.auctionId(), "DIRECT", 16_000L)))
                .isInstanceOf(BidRequestPayloadMismatchException.class);
        assertThat(jdbc.queryForList("""
                select bid_request_id, amount, correlation_id from bid_request where bidder_id = ? and idempotency_key = ?
                """, bidder, key)).hasSize(1).first().satisfies(request -> assertThat(request)
                .containsEntry("bid_request_id", requestId).containsEntry("amount", 15_000L)
                .containsEntry("correlation_id", "initial"));
        assertThat(jdbc.queryForList("""
                select partition_key, payload->>'bidRequestId' as request_id from outbox_event
                 where aggregate_id = ? and topic = 'bid-command' and event_type = 'BidCommandRequested'
                """, fixture.auctionId())).hasSize(1).first().satisfies(event -> assertThat(event)
                .containsEntry("partition_key", fixture.auctionId().toString())
                .containsEntry("request_id", requestId.toString()));
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
    void schedulerDoesNotCloseAnAuctionAtItsOriginalEndTimeAfterAnAcceptedBidExtendedIt() {
        Instant originalEndsAt = PROCESSED_AT.plusSeconds(240);
        Fixture fixture = fixture(1L, originalEndsAt);
        BidSettlementCommand command = acceptedCommand(fixture, originalEndsAt.plusSeconds(300));

        assertThat(repository.persist(command)).isTrue();
        AuctionCloseRepository closer = new JdbcAuctionCloseRepository(jdbc,
                new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())),
                new ObjectMapper(), UUID::randomUUID);

        assertThat(closer.closeExpired(originalEndsAt, 10)).isZero();
        assertThat(jdbc.queryForObject("select status from auction where auction_id = ?", String.class, fixture.auctionId())).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select ends_at from auction where auction_id = ?", Timestamp.class, fixture.auctionId()).toInstant())
                .isEqualTo(originalEndsAt.plusSeconds(300));
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and event_type = 'AuctionExtended'", Integer.class, fixture.auctionId()))
                .isEqualTo(1);
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
    void recordsLateRejectionWithoutChangingTheSoldResult() {
        Instant endsAt = PROCESSED_AT.plusSeconds(120);
        Fixture fixture = fixture(1L, endsAt);
        assertThat(repository.persist(acceptedCommand(fixture, endsAt))).isTrue();
        AuctionCloseRepository closer = new JdbcAuctionCloseRepository(jdbc,
                new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())),
                new ObjectMapper(), UUID::randomUUID);
        assertThat(closer.closeExpired(endsAt, 10)).isEqualTo(1);

        UUID lateRequestId = UUID.randomUUID();
        bidRequests.saveIfAbsent("bidder-late", lateRequestId.toString(), "b".repeat(64), "correlation-late", lateRequestId,
                new BidRequestCommand(fixture.auctionId(), "DIRECT", 35_000L));
        BidSettlementCommand late = new BidSettlementCommand(
                lateRequestId, fixture.auctionId(), "bidder-late", 35_000L,
                new DirectBidResult(DirectBidResultCode.AUCTION_ENDED, 13_000L, "bidder-2", 13_000L, endsAt, 3L),
                endsAt.plusSeconds(1), "correlation-late");

        assertThat(repository.persist(late)).isTrue();
        assertThat(jdbc.queryForObject("select status from bid_request where bid_request_id = ?", String.class, lateRequestId))
                .isEqualTo("REJECTED");
        assertThat(jdbc.queryForMap("select decision, rejection_reason from bid_ledger where bid_request_id = ?", lateRequestId))
                .containsEntry("decision", "REJECTED").containsEntry("rejection_reason", "AUCTION_ENDED");
        assertThat(jdbc.queryForObject("select count(*) from bid_ledger where auction_id = ? and decision = 'ACCEPTED'",
                Integer.class, fixture.auctionId())).isEqualTo(1);
        assertThat(jdbc.queryForMap("select status, current_price, version from auction where auction_id = ?", fixture.auctionId()))
                .containsEntry("status", "ENDED").containsEntry("current_price", 13_000L).containsEntry("version", 3L);
        assertThat(jdbc.queryForMap("select outcome, winner_id, final_price from auction_result where auction_id = ?", fixture.auctionId()))
                .containsEntry("outcome", "SOLD").containsEntry("winner_id", "bidder-2").containsEntry("final_price", 13_000L);
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
        return acceptedCommand(fixture, PROCESSED_AT.plusSeconds(900));
    }

    private static BidSettlementCommand acceptedCommand(Fixture fixture, Instant endsAt) {
        return new BidSettlementCommand(
                fixture.requestId(), fixture.auctionId(), "bidder-2", 13_000L,
                new DirectBidResult(DirectBidResultCode.ACCEPTED, 13_000L, "bidder-2", 13_000L, endsAt, 2L),
                PROCESSED_AT, "correlation-1");
    }

    private static Fixture fixture(long auctionVersion) {
        return fixture(auctionVersion, PROCESSED_AT.plusSeconds(600));
    }

    private static Fixture fixture(long auctionVersion, Instant endsAt) {
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
                """, auctionId, productId, Timestamp.from(PROCESSED_AT.minusSeconds(600)), Timestamp.from(endsAt), auctionVersion, Timestamp.from(PROCESSED_AT), Timestamp.from(PROCESSED_AT));
        jdbc.update("""
                insert into bid_request (bid_request_id, auction_id, bidder_id, bid_kind, amount, status, requested_at, correlation_id)
                values (?, ?, 'bidder-2', 'DIRECT', 13000, 'RECEIVED', ?, 'correlation-1')
                """, requestId, auctionId, Timestamp.from(PROCESSED_AT));
        return new Fixture(auctionId, requestId);
    }

    private record Fixture(UUID auctionId, UUID requestId) {
    }
}
