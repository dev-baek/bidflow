create table product (
    product_id uuid primary key,
    seller_id varchar(128) not null,
    title varchar(100) not null,
    description varchar(5000) not null,
    category_id varchar(64) not null,
    condition_grade varchar(16) not null,
    status varchar(16) not null,
    version bigint not null default 1,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    constraint ck_product_title_length check (char_length(btrim(title)) between 2 and 100),
    constraint ck_product_description_length check (char_length(btrim(description)) between 10 and 5000),
    constraint ck_product_category_not_blank check (char_length(btrim(category_id)) > 0),
    constraint ck_product_condition_grade check (condition_grade in ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR')),
    constraint ck_product_status check (status in ('PUBLISHED', 'UNPUBLISHED')),
    constraint ck_product_version check (version >= 1)
);

create index ix_product_seller_created_at on product (seller_id, created_at desc);

create table product_image (
    image_id uuid primary key,
    product_id uuid not null references product (product_id),
    object_key varchar(1024) not null,
    display_order integer not null,
    alt_text varchar(200),
    created_at timestamptz not null,
    constraint uq_product_image_display_order unique (product_id, display_order),
    constraint ck_product_image_display_order check (display_order >= 0),
    constraint ck_product_image_object_key_not_blank check (char_length(btrim(object_key)) > 0)
);

create table auction (
    auction_id uuid primary key,
    product_id uuid not null references product (product_id),
    seller_id varchar(128) not null,
    status varchar(16) not null,
    starting_price bigint not null,
    current_price bigint not null,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    version bigint not null default 1,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    constraint ck_auction_status check (status in ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED')),
    constraint ck_auction_starting_price check (starting_price >= 1000),
    constraint ck_auction_current_price check (current_price >= starting_price),
    constraint ck_auction_period check (ends_at > starts_at),
    constraint ck_auction_version check (version >= 1)
);

create unique index uq_auction_open_product
    on auction (product_id)
    where status in ('SCHEDULED', 'ACTIVE');

create index ix_auction_seller_status_ends_at on auction (seller_id, status, ends_at);
create index ix_auction_active_ends_at on auction (ends_at) where status = 'ACTIVE';

create table auction_result (
    auction_id uuid primary key references auction (auction_id),
    outcome varchar(16) not null,
    winner_id varchar(128),
    final_price bigint,
    determined_at timestamptz not null,
    constraint ck_auction_result_outcome check (outcome in ('SOLD', 'UNSOLD')),
    constraint ck_auction_result_values check (
        (outcome = 'SOLD' and winner_id is not null and final_price is not null and final_price >= 1000)
        or (outcome = 'UNSOLD' and winner_id is null and final_price is null)
    )
);

create table bid_request (
    bid_request_id uuid primary key,
    auction_id uuid not null references auction (auction_id),
    bidder_id varchar(128) not null,
    bid_kind varchar(16) not null,
    amount bigint not null,
    status varchar(16) not null,
    requested_at timestamptz not null,
    processed_at timestamptz,
    correlation_id varchar(128) not null,
    constraint ck_bid_request_kind check (bid_kind in ('DIRECT', 'AUTO_MAX')),
    constraint ck_bid_request_amount check (amount >= 1000),
    constraint ck_bid_request_status check (status in ('RECEIVED', 'ACCEPTED', 'REJECTED')),
    constraint ck_bid_request_correlation_id_not_blank check (char_length(btrim(correlation_id)) > 0)
);

create index ix_bid_request_auction_requested_at on bid_request (auction_id, requested_at);

create table bid_ledger (
    bid_ledger_id uuid primary key,
    bid_request_id uuid not null unique references bid_request (bid_request_id),
    auction_id uuid not null references auction (auction_id),
    bidder_id varchar(128) not null,
    decision varchar(16) not null,
    requested_amount bigint not null,
    current_price bigint,
    rejection_reason varchar(64),
    decided_at timestamptz not null,
    constraint ck_bid_ledger_decision check (decision in ('ACCEPTED', 'REJECTED')),
    constraint ck_bid_ledger_requested_amount check (requested_amount >= 1000),
    constraint ck_bid_ledger_accepted_values check (
        (decision = 'ACCEPTED' and current_price is not null and current_price >= 1000 and rejection_reason is null)
        or (decision = 'REJECTED' and current_price is null and rejection_reason is not null)
    )
);

create index ix_bid_ledger_auction_decided_at on bid_ledger (auction_id, decided_at);

create table outbox_event (
    event_id uuid primary key,
    aggregate_type varchar(64) not null,
    aggregate_id uuid not null,
    topic varchar(64) not null,
    partition_key varchar(128) not null,
    event_type varchar(64) not null,
    schema_version integer not null,
    payload jsonb not null,
    occurred_at timestamptz not null,
    published_at timestamptz,
    publish_attempts integer not null default 0,
    constraint ck_outbox_topic check (topic in ('listing-event', 'bid-command', 'bid-event')),
    constraint ck_outbox_schema_version check (schema_version >= 1),
    constraint ck_outbox_payload_object check (jsonb_typeof(payload) = 'object'),
    constraint ck_outbox_publish_attempts check (publish_attempts >= 0),
    constraint ck_outbox_partition_key_not_blank check (char_length(btrim(partition_key)) > 0)
);

create index ix_outbox_unpublished_occurred_at on outbox_event (occurred_at) where published_at is null;
