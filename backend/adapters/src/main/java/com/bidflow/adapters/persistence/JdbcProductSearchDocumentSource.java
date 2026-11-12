package com.bidflow.adapters.persistence;

import com.bidflow.application.search.ProductSearchDocument;
import com.bidflow.application.search.ProductSearchDocumentSource;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Optional;
import java.util.List;
import java.util.UUID;

public final class JdbcProductSearchDocumentSource implements ProductSearchDocumentSource {
    private static final String SELECT = """
            select p.product_id, a.auction_id, p.seller_id, p.title, p.category_id, p.condition_grade,
                   (select object_key from product_image where product_id = p.product_id order by display_order limit 1) as thumbnail_object_key,
                   a.starting_price, a.current_price, a.status, p.status as product_status,
                   a.starts_at, a.ends_at, p.version as listing_version, a.version as auction_version
            from product p join lateral (
                select * from auction where product_id = p.product_id order by created_at desc limit 1
            ) a on true
            """;
    private final JdbcTemplate jdbc;

    public JdbcProductSearchDocumentSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<ProductSearchDocument> findByProductId(UUID productId) {
        return find("p.product_id = ?", productId);
    }

    @Override
    public Optional<ProductSearchDocument> findByAuctionId(UUID auctionId) {
        return find("a.auction_id = ?", auctionId);
    }

    @Override
    public List<ProductSearchDocument> findPageAfter(UUID productId, int limit) {
        if (productId == null) {
            return jdbc.query(SELECT + "order by p.product_id limit ?", (resultSet, row) -> map(resultSet), limit);
        }
        return jdbc.query(SELECT + "where p.product_id > ? order by p.product_id limit ?", (resultSet, row) -> map(resultSet), productId, limit);
    }

    private Optional<ProductSearchDocument> find(String predicate, UUID id) {
        return jdbc.query(SELECT + "where " + predicate, resultSet -> resultSet.next() ? Optional.of(map(resultSet)) : Optional.empty(), id);
    }

    private static ProductSearchDocument map(java.sql.ResultSet resultSet) throws java.sql.SQLException {
        return new ProductSearchDocument(
                resultSet.getObject("product_id", UUID.class), resultSet.getObject("auction_id", UUID.class),
                resultSet.getString("seller_id"), resultSet.getString("title"), resultSet.getString("category_id"),
                resultSet.getString("condition_grade"), resultSet.getString("thumbnail_object_key"),
                resultSet.getLong("starting_price"), resultSet.getLong("current_price"), resultSet.getString("status"),
                "PUBLISHED".equals(resultSet.getString("product_status"))
                        && ("SCHEDULED".equals(resultSet.getString("status")) || "ACTIVE".equals(resultSet.getString("status"))),
                resultSet.getTimestamp("starts_at").toInstant(), resultSet.getTimestamp("ends_at").toInstant(),
                resultSet.getLong("listing_version"), resultSet.getLong("auction_version"), java.time.Instant.now());
    }
}
