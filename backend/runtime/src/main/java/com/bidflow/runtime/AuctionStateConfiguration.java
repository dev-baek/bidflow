package com.bidflow.runtime;

import com.bidflow.adapters.persistence.RedisAuctionStateRepository;
import com.bidflow.application.bid.AuctionStateRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

@Configuration
class AuctionStateConfiguration {
    @Bean
    AuctionStateRepository auctionStateRepository(StringRedisTemplate redis) {
        return new RedisAuctionStateRepository(redis);
    }
}
