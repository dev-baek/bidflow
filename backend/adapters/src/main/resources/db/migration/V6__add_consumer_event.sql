create table consumer_event (
    consumer_name varchar(64) not null,
    event_id uuid not null,
    processed_at timestamptz not null,
    source_topic varchar(64) not null,
    source_partition integer not null,
    source_offset bigint not null,
    primary key (consumer_name, event_id),
    constraint ck_consumer_event_name_not_blank check (char_length(btrim(consumer_name)) > 0),
    constraint ck_consumer_event_topic_not_blank check (char_length(btrim(source_topic)) > 0),
    constraint ck_consumer_event_partition check (source_partition >= 0),
    constraint ck_consumer_event_offset check (source_offset >= 0)
);
