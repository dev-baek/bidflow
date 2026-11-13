create table auto_bid_maximum (
    auction_id uuid not null references auction (auction_id),
    bidder_id varchar(128) not null,
    maximum bigint not null,
    updated_at timestamptz not null,
    primary key (auction_id, bidder_id),
    constraint ck_auto_bid_maximum_bidder_not_blank check (char_length(btrim(bidder_id)) > 0),
    constraint ck_auto_bid_maximum_value check (maximum >= 1000)
);

create index ix_auto_bid_maximum_auction_maximum on auto_bid_maximum (auction_id, maximum desc);
