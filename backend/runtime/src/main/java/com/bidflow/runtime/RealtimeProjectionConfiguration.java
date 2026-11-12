package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcAuctionRealtimeSnapshotReader;
import com.bidflow.application.realtime.AuctionRealtimeSnapshotReader;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
class RealtimeProjectionConfiguration {
    @Bean
    AuctionRealtimeSnapshotReader auctionRealtimeSnapshotReader(JdbcTemplate jdbc) {
        return new JdbcAuctionRealtimeSnapshotReader(jdbc);
    }
}
