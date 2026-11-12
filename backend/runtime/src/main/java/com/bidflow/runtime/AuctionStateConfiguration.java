package com.bidflow.runtime;

import com.bidflow.adapters.persistence.RedisAuctionStateRepository;
import com.bidflow.adapters.persistence.RedisAutoBidProcessor;
import com.bidflow.adapters.persistence.RedisDirectBidProcessor;
import com.bidflow.application.bid.AuctionStateRepository;
import com.bidflow.application.bid.AutoBidProcessor;
import com.bidflow.application.bid.DirectBidProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

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
}
