package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.auction.AuctionCloseRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Supplier;
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
class JdbcAuctionCloseRecoveryIntegrationTest {
    private static final Instant ENDS_AT = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static TransactionTemplate transaction;

    @BeforeAll
    static void setup() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }

    @Test
    void delayedPollingStillClosesOnlyOnceAndLaterPollsAreNoOps() {
        UUID auctionId = fixture();
        AuctionCloseRepository repository = repository(UUID::randomUUID);

        assertThat(repository.closeExpired(ENDS_AT.plusSeconds(60), 10)).isEqualTo(1);
        assertThat(repository.closeExpired(ENDS_AT.plusSeconds(120), 10)).isZero();

        assertThat(jdbc.queryForObject("select count(*) from auction_result where auction_id = ?", Integer.class, auctionId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and event_type = 'AuctionEnded'", Integer.class, auctionId)).isEqualTo(1);
    }

    @Test
    void rollsBackTheWholeCloseAndLetsTheNextPollingRetryAfterOutboxCreationFails() {
        UUID auctionId = fixture();
        AuctionCloseRepository failingRepository = repository(() -> { throw new IllegalStateException("outbox id generation failed"); });

        assertThatThrownBy(() -> failingRepository.closeExpired(ENDS_AT, 10)).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("select status from auction where auction_id = ?", String.class, auctionId)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select count(*) from auction_result where auction_id = ?", Integer.class, auctionId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where aggregate_id = ? and event_type = 'AuctionEnded'", Integer.class, auctionId)).isZero();

        assertThat(repository(UUID::randomUUID).closeExpired(ENDS_AT.plusSeconds(1), 10)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select status from auction where auction_id = ?", String.class, auctionId)).isEqualTo("ENDED");
        assertThat(jdbc.queryForObject("select count(*) from auction_result where auction_id = ?", Integer.class, auctionId)).isEqualTo(1);
    }

    private static AuctionCloseRepository repository(Supplier<UUID> ids) {
        return new JdbcAuctionCloseRepository(jdbc, transaction, new ObjectMapper(), ids);
    }

    private static UUID fixture() {
        UUID productId = UUID.randomUUID();
        UUID auctionId = UUID.randomUUID();
        jdbc.update("""
                insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                values (?, 'seller-1', '테스트 상품', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, ?, ?)
                """, productId, Timestamp.from(ENDS_AT), Timestamp.from(ENDS_AT));
        jdbc.update("""
                insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, current_winner_id, starts_at, ends_at, version, created_at, updated_at)
                values (?, ?, 'seller-1', 'ACTIVE', 1000, 13000, 'bidder-1', ?, ?, 4, ?, ?)
                """, auctionId, productId, Timestamp.from(ENDS_AT.minusSeconds(600)), Timestamp.from(ENDS_AT), Timestamp.from(ENDS_AT), Timestamp.from(ENDS_AT));
        return auctionId;
    }
}
