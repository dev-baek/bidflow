package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcConsumerEventRepository;
import com.bidflow.application.consumer.ConsumerEventProcessor;
import com.bidflow.application.consumer.ConsumerEventRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
class ConsumerEventConfiguration {
    @Bean
    ConsumerEventRepository consumerEventRepository(JdbcTemplate jdbc) {
        return new JdbcConsumerEventRepository(jdbc);
    }

    @Bean
    ConsumerEventProcessor consumerEventProcessor(ConsumerEventRepository events, TransactionTemplate transaction) {
        return new TransactionalConsumerEventProcessor(events, transaction);
    }
}
