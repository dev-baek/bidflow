alter table outbox_event add column enqueued_at timestamptz;
alter table outbox_event alter column enqueued_at set default clock_timestamp();
