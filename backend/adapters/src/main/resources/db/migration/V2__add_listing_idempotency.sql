create table listing_idempotency (
    seller_id varchar(128) not null,
    idempotency_key varchar(128) not null,
    payload_hash char(64) not null,
    product_id uuid not null references product (product_id),
    auction_id uuid not null references auction (auction_id),
    created_at timestamptz not null,
    primary key (seller_id, idempotency_key)
);
