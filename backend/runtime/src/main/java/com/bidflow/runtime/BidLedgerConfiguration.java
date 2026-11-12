package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcBidLedgerRepository;
import com.bidflow.application.bid.BidLedgerRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
class BidLedgerConfiguration {
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    BidLedgerRepository bidLedgerRepository(JdbcTemplate jdbc, TransactionTemplate transaction, ObjectMapper objectMapper) {
        return new JdbcBidLedgerRepository(jdbc, transaction, objectMapper, UUID::randomUUID);
    }
}
