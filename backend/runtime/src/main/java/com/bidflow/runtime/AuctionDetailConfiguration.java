package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcAuctionDetailSnapshotReader;
import com.bidflow.application.auction.AuctionDetailSnapshotReader;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
class AuctionDetailConfiguration {
    @Bean
    AuctionDetailSnapshotReader auctionDetailSnapshotReader(JdbcTemplate jdbc) {
        return new JdbcAuctionDetailSnapshotReader(jdbc);
    }
}
