package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventRepository;
import java.time.Instant;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class JdbcConsumerEventRepositoryIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.5-alpine");

    private static JdbcTemplate jdbc;
    private static ConsumerEventRepository repository;

    @BeforeAll
    static void setup() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        var dataSource = new org.springframework.jdbc.datasource.DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        repository = new JdbcConsumerEventRepository(jdbc);
    }

    @Test
    void recordsOneEventPerConsumerButAllowsIndependentConsumers() {
        UUID eventId = UUID.randomUUID();
        ConsumerEvent realtime = new ConsumerEvent("realtime-projection", eventId, "bid-event", 1, 42L, Instant.parse("2030-01-01T12:00:00Z"));
        ConsumerEvent search = new ConsumerEvent("search-projection", eventId, "bid-event", 1, 42L, Instant.parse("2030-01-01T12:00:00Z"));

        assertThat(repository.markProcessed(realtime)).isTrue();
        assertThat(repository.markProcessed(realtime)).isFalse();
        assertThat(repository.markProcessed(search)).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from consumer_event where event_id = ?", Integer.class, eventId)).isEqualTo(2);
    }
}
