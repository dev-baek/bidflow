package com.bidflow.adapters.persistence;

import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventRepository;
import java.sql.Timestamp;
import org.springframework.jdbc.core.JdbcTemplate;

/** PostgreSQL implementation backed by the consumer_name/event_id primary key. */
public final class JdbcConsumerEventRepository implements ConsumerEventRepository {
    private final JdbcTemplate jdbc;

    public JdbcConsumerEventRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean markProcessed(ConsumerEvent event) {
        return jdbc.update("""
                insert into consumer_event (consumer_name, event_id, processed_at, source_topic, source_partition, source_offset)
                values (?, ?, ?, ?, ?, ?)
                on conflict (consumer_name, event_id) do nothing
                """, event.consumerName(), event.eventId(), Timestamp.from(event.processedAt()), event.sourceTopic(),
                event.sourcePartition(), event.sourceOffset()) == 1;
    }
}
