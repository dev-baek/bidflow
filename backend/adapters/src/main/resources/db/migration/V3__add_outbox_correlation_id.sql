alter table outbox_event
    add column correlation_id varchar(128) not null default 'legacy';

alter table outbox_event
    add constraint ck_outbox_correlation_id_not_blank
    check (char_length(btrim(correlation_id)) > 0);
