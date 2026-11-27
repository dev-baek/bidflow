package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcAuctionDetailSnapshotReader;
import com.bidflow.adapters.persistence.JdbcPrivateAuctionOutcomeReader;
import com.bidflow.adapters.persistence.JdbcPublicAuctionImageReader;
import com.bidflow.application.auction.AuctionDetailSnapshotReader;
import com.bidflow.application.auction.PrivateAuctionOutcomeReader;
import com.bidflow.application.auction.PublicAuctionImages;
import com.bidflow.application.storage.ObjectStorage;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
class AuctionDetailConfiguration {
    @Bean
    PublicAuctionImages publicAuctionImages(JdbcTemplate jdbc, ObjectStorage storage) {
        return new PublicAuctionImages(new JdbcPublicAuctionImageReader(jdbc), storage);
    }

    @Bean
    AuctionDetailSnapshotReader auctionDetailSnapshotReader(JdbcTemplate jdbc) {
        return new JdbcAuctionDetailSnapshotReader(jdbc);
    }

    @Bean
    PrivateAuctionOutcomeReader privateAuctionOutcomeReader(JdbcTemplate jdbc) {
        return new JdbcPrivateAuctionOutcomeReader(jdbc);
    }
}
