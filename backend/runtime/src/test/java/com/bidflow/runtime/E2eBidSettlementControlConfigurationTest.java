package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;

class E2eBidSettlementControlConfigurationTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withBean(KafkaListenerEndpointRegistry.class, () -> mock(KafkaListenerEndpointRegistry.class))
            .withUserConfiguration(E2eBidSettlementControlController.class);

    @Test
    void requiresBothProfiles() {
        for (String profiles : new String[] {"local", "e2e", "prod"}) {
            context.withPropertyValues("spring.profiles.active=" + profiles,
                            "server.address=127.0.0.1", "bidflow.e2e.bid-settlement-control-enabled=true")
                    .run(app -> assertThat(app).doesNotHaveBean(E2eBidSettlementControlController.class));
        }
    }

    @Test
    void requiresExplicitOptInAndLoopbackWithoutTrustedForwardedHeaders() {
        var e2e = context.withPropertyValues("spring.profiles.active=local,e2e");
        e2e.withPropertyValues("server.address=127.0.0.1")
                .run(app -> assertThat(app).doesNotHaveBean(E2eBidSettlementControlController.class));
        var optedIn = e2e.withPropertyValues("bidflow.e2e.bid-settlement-control-enabled=true");
        optedIn.withPropertyValues("server.address=0.0.0.0")
                .run(app -> assertThat(app).doesNotHaveBean(E2eBidSettlementControlController.class));
        optedIn.withPropertyValues("server.address=127.0.0.1", "server.forward-headers-strategy=framework")
                .run(app -> assertThat(app).doesNotHaveBean(E2eBidSettlementControlController.class));
        optedIn.withPropertyValues("server.address=127.0.0.1")
                .run(app -> assertThat(app).hasSingleBean(E2eBidSettlementControlController.class));
    }
}
