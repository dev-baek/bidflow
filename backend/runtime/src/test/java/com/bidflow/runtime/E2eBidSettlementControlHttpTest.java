package com.bidflow.runtime;

import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.listener.MessageListenerContainer;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = E2eBidSettlementControlController.class, properties = {
        "bidflow.e2e.bid-settlement-control-enabled=true", "server.address=127.0.0.1"
})
@Import(LocalHttpSecurityConfiguration.class)
@ActiveProfiles({"local", "e2e"})
class E2eBidSettlementControlHttpTest {
    private static final String BASE = "/api/internal/e2e/bid-settlement";

    @Autowired MockMvc mvc;
    @MockitoBean KafkaListenerEndpointRegistry registry;

    @BeforeEach
    void ignoreRegistryApplicationStartup() {
        clearInvocations(registry);
    }

    @Test
    void controlsOnlyTheNamedSettlementContainer() throws Exception {
        var listener = mock(MessageListenerContainer.class);
        when(registry.getListenerContainer("bid-settlement")).thenReturn(listener);

        mvc.perform(post(BASE + "/stop").header("X-Actor-Id", "local-experiment"))
                .andExpect(status().isNoContent());
        mvc.perform(post(BASE + "/start").header("X-Actor-Id", "local-experiment"))
                .andExpect(status().isNoContent());

        verify(registry, times(2)).getListenerContainer("bid-settlement");
        verify(listener).stop();
        verify(listener).start();
        verifyNoMoreInteractions(registry, listener);
    }

    @Test
    void blocksAnonymousOrNonLoopbackRequestsEvenWithForwardedHeader() throws Exception {
        mvc.perform(post(BASE + "/stop")).andExpect(status().isUnauthorized());
        mvc.perform(post(BASE + "/stop").header("X-Actor-Id", "local-experiment")
                        .header("X-Forwarded-For", "127.0.0.1")
                        .with(request -> { request.setRemoteAddr("192.0.2.10"); return request; }))
                .andExpect(status().isForbidden());
        verifyNoInteractions(registry);
    }

    @Test
    void failsWithoutOperatingOnOtherListenersIfSettlementIsUnavailable() throws Exception {
        mvc.perform(post(BASE + "/start").header("X-Actor-Id", "local-experiment"))
                .andExpect(status().isServiceUnavailable());
        verify(registry).getListenerContainer("bid-settlement");
        verifyNoMoreInteractions(registry);
    }
}
