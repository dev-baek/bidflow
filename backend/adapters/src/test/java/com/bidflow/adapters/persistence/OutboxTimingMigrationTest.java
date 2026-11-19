package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class OutboxTimingMigrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    @Test void leavesOldRowsUnknownAndTimesNewRowsWithDatabaseClock() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .target(MigrationVersion.fromVersion("8")).load().migrate();
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        UUID old = insert(jdbc);
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()).load().migrate();
        UUID fresh = insert(jdbc);
        UUID future = insert(jdbc);
        jdbc.update("update outbox_event set enqueued_at = clock_timestamp() + interval '1 hour' where event_id = ?", future);
        var events = new JdbcOutboxRepository(jdbc).findPending();
        assertThat(events).hasSize(3);
        assertThat(events.stream().filter(e -> e.eventId().equals(old)).findFirst().orElseThrow().pendingAgeMs()).isNull();
        assertThat(events.stream().filter(e -> e.eventId().equals(fresh)).findFirst().orElseThrow().pendingAgeMs()).isNotNegative();
        assertThat(events.stream().filter(e -> e.eventId().equals(future)).findFirst().orElseThrow().pendingAgeMs()).isNegative();
        assertThat(jdbc.queryForObject("select count(*) from outbox_event where occurred_at = '2030-01-01T00:00:00Z' and payload = '{}'::jsonb", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("select enqueued_at is null from outbox_event where event_id = ?", Boolean.class, old)).isTrue();
    }

    private UUID insert(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into outbox_event(event_id,aggregate_type,aggregate_id,topic,partition_key,event_type,schema_version,payload,occurred_at,correlation_id)
                values (?,'Product',?,'listing-event','product','ListingPublished',1,'{}','2030-01-01T00:00:00Z','timing-test')
                """, id, UUID.randomUUID());
        return id;
    }
}
