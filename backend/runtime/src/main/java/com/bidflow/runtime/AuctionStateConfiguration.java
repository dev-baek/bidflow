package com.bidflow.runtime;

import com.bidflow.adapters.persistence.RedisAuctionStateRepository;
import com.bidflow.adapters.persistence.RedisAuctionActiveStateCleaner;
import com.bidflow.adapters.persistence.RedisAutoBidProcessor;
import com.bidflow.adapters.persistence.RedisDirectBidProcessor;
import com.bidflow.adapters.persistence.JdbcAutoBidMaximumRepository;
import com.bidflow.adapters.persistence.JdbcAuctionRecoverySnapshotRepository;
import com.bidflow.application.auction.AuctionActiveStateCleaner;
import com.bidflow.application.bid.AutoBidMaximumRepository;
import com.bidflow.application.bid.AuctionRecoverySnapshotRepository;
import com.bidflow.application.bid.AuctionStateRecoveryService;
import com.bidflow.application.bid.AuctionStateRepository;
import com.bidflow.application.bid.AutoBidProcessor;
import com.bidflow.application.bid.DirectBidProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.Clock;

@Configuration
class AuctionStateConfiguration {
    @Bean
    AuctionStateRepository auctionStateRepository(StringRedisTemplate redis) {
        return new RedisAuctionStateRepository(redis);
    }

    @Bean
    DirectBidProcessor directBidProcessor(StringRedisTemplate redis) {
        return new RedisDirectBidProcessor(redis);
    }

    @Bean
    AutoBidProcessor autoBidProcessor(StringRedisTemplate redis) {
        return new RedisAutoBidProcessor(redis);
    }

    @Bean
    AuctionActiveStateCleaner auctionActiveStateCleaner(StringRedisTemplate redis) {
        return new RedisAuctionActiveStateCleaner(redis);
    }

    @Bean
    AutoBidMaximumRepository autoBidMaximumRepository(JdbcTemplate jdbc, Clock clock) {
        return new JdbcAutoBidMaximumRepository(jdbc, clock);
    }

    @Bean
    AuctionRecoverySnapshotRepository auctionRecoverySnapshotRepository(JdbcTemplate jdbc) {
        return new JdbcAuctionRecoverySnapshotRepository(jdbc);
    }

    @Bean
    AuctionStateRecoveryService auctionStateRecoveryService(AuctionRecoverySnapshotRepository snapshots,
            AuctionStateRepository states, AuctionActiveStateCleaner cleaner) {
        return new AuctionStateRecoveryService(snapshots, states, cleaner);
    }
}
