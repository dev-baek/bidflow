create index ix_auction_open_ends_at
    on auction (ends_at)
    where status in ('SCHEDULED', 'ACTIVE');

drop index ix_auction_active_ends_at;
