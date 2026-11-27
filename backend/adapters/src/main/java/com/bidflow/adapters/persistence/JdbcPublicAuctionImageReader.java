package com.bidflow.adapters.persistence;

import com.bidflow.application.auction.PublicAuctionImageReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

public final class JdbcPublicAuctionImageReader implements PublicAuctionImageReader {
    private static final String PUBLIC_AUCTION_IMAGES = """
              from auction a
              join product p on a.product_id = p.product_id
         left join product_image i on p.product_id = i.product_id
             where a.auction_id = ?
               and p.status = 'PUBLISHED'
               and a.status in ('SCHEDULED', 'ACTIVE', 'ENDED')
            """;
    private final JdbcTemplate jdbc;

    public JdbcPublicAuctionImageReader(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<List<UUID>> findImageIds(UUID auctionId) {
        return jdbc.query("select i.image_id " + PUBLIC_AUCTION_IMAGES + " order by i.display_order", rows -> {
            if (!rows.next()) return Optional.empty();
            var ids = new ArrayList<UUID>();
            do {
                var id = rows.getObject("image_id", UUID.class);
                if (id != null) ids.add(id);
            } while (rows.next());
            return Optional.of(List.copyOf(ids));
        }, auctionId);
    }

    @Override
    public Optional<String> findObjectKey(UUID auctionId, UUID imageId) {
        return jdbc.query("select i.object_key " + PUBLIC_AUCTION_IMAGES + " and i.image_id = ?",
                rows -> rows.next() ? Optional.of(rows.getString("object_key")) : Optional.empty(), auctionId, imageId);
    }

    @Override
    public Optional<String> findThumbnailObjectKey(UUID auctionId) {
        return jdbc.query("select i.object_key " + PUBLIC_AUCTION_IMAGES + " order by i.display_order limit 1",
                rows -> rows.next() ? Optional.ofNullable(rows.getString("object_key")) : Optional.empty(), auctionId);
    }
}
