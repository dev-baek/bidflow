package com.bidflow.runtime;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.kafka.KafkaConnectionDetails;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("msk")
class MskKafkaConfiguration {
    @Bean
    KafkaConnectionDetails mskConnectionDetails(@Value("${BIDFLOW_MSK_BOOTSTRAP_SERVERS:}") String bootstrapServers) {
        var brokers = Arrays.stream(bootstrapServers.split(",", -1)).map(String::strip).toList();
        if (brokers.stream().anyMatch(String::isEmpty)) {
            throw new IllegalArgumentException("MSK requires BIDFLOW_MSK_BOOTSTRAP_SERVERS with no empty entries.");
        }
        return () -> brokers;
    }
}
