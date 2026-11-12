package com.bidflow.adapters.persistence;

import com.bidflow.application.listing.IdempotencyRecord;
import com.bidflow.application.listing.ListingRegistrationRepository;
import com.bidflow.application.listing.NewListingRegistration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.util.Optional;

public final class JdbcListingRegistrationRepository implements ListingRegistrationRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;

    public JdbcListingRegistrationRepository(JdbcTemplate jdbc, TransactionTemplate transaction) {
        this.jdbc = jdbc;
        this.transaction = transaction;
    }

    @Override
    public Optional<IdempotencyRecord> findIdempotency(String sellerId, String key) {
        return jdbc.query("""
                select payload_hash, product_id, auction_id
                from listing_idempotency where seller_id = ? and idempotency_key = ?
                """, resultSet -> resultSet.next()
                ? Optional.of(new IdempotencyRecord(resultSet.getString("payload_hash"),
                    new com.bidflow.application.listing.ListingRegistrationResult(
                        resultSet.getObject("product_id", java.util.UUID.class), resultSet.getObject("auction_id", java.util.UUID.class), "SCHEDULED")))
                : Optional.empty(), sellerId, key);
    }

    @Override
    public void save(NewListingRegistration value) {
        transaction.executeWithoutResult(status -> {
            var product = value.product();
            jdbc.update("insert into product (product_id,seller_id,title,description,category_id,condition_grade,status,version,created_at,updated_at) values (?,?,?,?,?,?, 'PUBLISHED',1,?,?)", value.result().productId(), value.sellerId(), product.title(), product.description(), product.categoryId(), product.conditionGrade().name(), Timestamp.from(value.outbox().occurredAt()), Timestamp.from(value.outbox().occurredAt()));
            var auction = value.auction();
            jdbc.update("insert into auction (auction_id,product_id,seller_id,status,starting_price,current_price,starts_at,ends_at,version,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)", auction.auctionId(), auction.productId(), auction.sellerId(), auction.status().name(), auction.startingPrice(), auction.currentPrice(), Timestamp.from(auction.startsAt()), Timestamp.from(auction.endsAt()), auction.version(), Timestamp.from(value.outbox().occurredAt()), Timestamp.from(value.outbox().occurredAt()));
            for (var image : value.images()) {
                jdbc.update("insert into product_image (image_id,product_id,object_key,display_order,created_at) values (?,?,?,?,?)", image.imageId(), value.result().productId(), image.objectKey(), image.displayOrder(), Timestamp.from(value.outbox().occurredAt()));
            }
            jdbc.update("insert into listing_idempotency (seller_id,idempotency_key,payload_hash,product_id,auction_id,created_at) values (?,?,?,?,?,?)", value.sellerId(), value.idempotencyKey(), value.payloadHash(), value.result().productId(), value.result().auctionId(), Timestamp.from(value.outbox().occurredAt()));
            jdbc.update("insert into outbox_event (event_id,aggregate_type,aggregate_id,topic,partition_key,event_type,schema_version,payload,occurred_at) values (?,'Product',?,'listing-event',?,'ListingPublished',1,cast(? as jsonb),?)", value.outbox().eventId(), value.outbox().aggregateId(), value.outbox().aggregateId().toString(), value.outbox().payload(), Timestamp.from(value.outbox().occurredAt()));
        });
    }
}
