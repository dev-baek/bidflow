alter table bid_request add column idempotency_key varchar(128);
alter table bid_request add column payload_hash char(64);
create unique index uq_bid_request_idempotency on bid_request (bidder_id, idempotency_key) where idempotency_key is not null;
