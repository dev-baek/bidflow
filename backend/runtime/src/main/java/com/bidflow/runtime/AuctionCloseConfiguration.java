package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcAuctionCloseRepository;
import com.bidflow.application.auction.AuctionCloseRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
class AuctionCloseConfiguration {
    @Bean
    AuctionCloseRepository auctionCloseRepository(JdbcTemplate jdbc, TransactionTemplate transaction, ObjectMapper objectMapper) {
        return new JdbcAuctionCloseRepository(jdbc, transaction, objectMapper, UUID::randomUUID);
    }
}
