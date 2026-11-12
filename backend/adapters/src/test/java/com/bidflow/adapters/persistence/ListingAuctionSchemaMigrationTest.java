package com.bidflow.adapters.persistence;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
class ListingAuctionSchemaMigrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    @BeforeAll
    static void migrate() {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @Test
    void createsListingAuctionAndEventLedgerTables() throws SQLException {
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     select table_name
                     from information_schema.tables
                     where table_schema = 'public'
                     order by table_name
                     """)) {
            ResultSet resultSet = statement.executeQuery();
            var tableNames = new java.util.ArrayList<String>();
            while (resultSet.next()) {
                tableNames.add(resultSet.getString("table_name"));
            }

            assertThat(tableNames).contains(
                    "product",
                    "product_image",
                    "auction",
                    "auction_result",
                    "bid_request",
                    "bid_ledger",
                    "outbox_event"
            );
        }
    }

    @Test
    void createsIndexesForAuctionClosingAndOutboxPublishing() throws SQLException {
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     select indexname
                     from pg_indexes
                     where schemaname = 'public'
                     """)) {
            ResultSet resultSet = statement.executeQuery();
            var indexNames = new java.util.ArrayList<String>();
            while (resultSet.next()) {
                indexNames.add(resultSet.getString("indexname"));
            }

            assertThat(indexNames).contains(
                    "uq_auction_open_product",
                    "ix_auction_seller_status_ends_at",
                    "ix_auction_active_ends_at",
                    "ix_bid_request_auction_requested_at",
                    "ix_outbox_unpublished_occurred_at"
            );
        }
    }

    @Test
    void permitsOnlyOneOpenAuctionForOneProduct() throws SQLException {
        UUID productId = insertProduct();
        insertAuction(productId, "SCHEDULED", Instant.parse("2026-11-12T01:00:00Z"), Instant.parse("2026-11-12T02:00:00Z"));

        assertThatThrownBy(() -> insertAuction(
                productId,
                "ACTIVE",
                Instant.parse("2026-11-12T01:00:00Z"),
                Instant.parse("2026-11-12T02:00:00Z")
        )).isInstanceOf(SQLException.class);
    }

    @Test
    void rejectsInvalidStartingPriceAtDatabaseBoundary() throws SQLException {
        UUID productId = insertProduct();

        assertThatThrownBy(() -> insertAuction(
                productId,
                "SCHEDULED",
                Instant.parse("2026-11-12T01:00:00Z"),
                Instant.parse("2026-11-12T01:00:00Z"),
                999L
        )).isInstanceOf(SQLException.class);
    }

    @Test
    void rejectsAnEmptyAuctionPeriodAtDatabaseBoundary() throws SQLException {
        UUID productId = insertProduct();

        assertThatThrownBy(() -> insertAuction(
                productId,
                "SCHEDULED",
                Instant.parse("2026-11-12T01:00:00Z"),
                Instant.parse("2026-11-12T01:00:00Z"),
                1_000L
        )).isInstanceOf(SQLException.class);
    }

    @Test
    void selectsExpiredActiveAuctionsWithSkipLockedQuery() throws SQLException {
        UUID productId = insertProduct();
        UUID auctionId = insertAuction(
                productId,
                "ACTIVE",
                Instant.parse("2026-11-12T01:00:00Z"),
                Instant.parse("2026-11-12T01:30:00Z")
        );

        try (Connection connection = connection()) {
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement("""
                    select auction_id
                    from auction
                    where status = 'ACTIVE' and ends_at <= ?
                    order by ends_at
                    for update skip locked
                    limit 10
                    """)) {
                statement.setTimestamp(1, Timestamp.from(Instant.parse("2026-11-12T01:30:00Z")));
                ResultSet resultSet = statement.executeQuery();

                assertThat(resultSet.next()).isTrue();
                assertThat(resultSet.getObject("auction_id", UUID.class)).isEqualTo(auctionId);
            } finally {
                connection.rollback();
            }
        }
    }

    private static Connection connection() throws SQLException {
        return java.sql.DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static UUID insertProduct() throws SQLException {
        UUID productId = UUID.randomUUID();
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     insert into product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
                     values (?, 'seller-1', '테스트 상품', '테스트를 위한 충분한 설명입니다.', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, now(), now())
                     """)) {
            statement.setObject(1, productId);
            statement.executeUpdate();
        }
        return productId;
    }

    private static UUID insertAuction(UUID productId, String status, Instant startsAt, Instant endsAt) throws SQLException {
        return insertAuction(productId, status, startsAt, endsAt, 1_000L);
    }

    private static UUID insertAuction(UUID productId, String status, Instant startsAt, Instant endsAt, long startingPrice) throws SQLException {
        UUID auctionId = UUID.randomUUID();
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement("""
                     insert into auction (auction_id, product_id, seller_id, status, starting_price, current_price, starts_at, ends_at, version, created_at, updated_at)
                     values (?, ?, 'seller-1', ?, ?, ?, ?, ?, 1, now(), now())
                     """)) {
            statement.setObject(1, auctionId);
            statement.setObject(2, productId);
            statement.setString(3, status);
            statement.setLong(4, startingPrice);
            statement.setLong(5, startingPrice);
            statement.setTimestamp(6, Timestamp.from(startsAt));
            statement.setTimestamp(7, Timestamp.from(endsAt));
            statement.executeUpdate();
        }
        return auctionId;
    }
}
