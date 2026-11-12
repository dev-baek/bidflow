package com.bidflow.adapters.persistence;

import com.bidflow.application.outbox.OutboxEvent;
import com.bidflow.application.outbox.OutboxRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class JdbcOutboxRepository implements OutboxRepository {
    private final JdbcTemplate jdbc;
    public JdbcOutboxRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public List<OutboxEvent> findPending() {
        return jdbc.query("select event_id,topic,partition_key,correlation_id,event_type,payload::text,occurred_at from outbox_event where published_at is null order by occurred_at limit 100", (rs, row) -> new OutboxEvent(rs.getObject("event_id", UUID.class), rs.getString("topic"), rs.getString("partition_key"), rs.getString("correlation_id"), rs.getString("event_type"), rs.getString("payload"), rs.getTimestamp("occurred_at").toInstant()));
    }
    public void markPublished(UUID eventId, Instant publishedAt) { jdbc.update("update outbox_event set published_at = ? where event_id = ? and published_at is null", Timestamp.from(publishedAt), eventId); }
}
