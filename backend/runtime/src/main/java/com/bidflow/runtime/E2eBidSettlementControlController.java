package com.bidflow.runtime;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.listener.MessageListenerContainer;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Profile("local & e2e")
@ConditionalOnProperty(name = "bidflow.e2e.bid-settlement-control-enabled", havingValue = "true")
@ConditionalOnProperty(name = "server.address", havingValue = "127.0.0.1")
@ConditionalOnProperty(name = "server.forward-headers-strategy", havingValue = "none", matchIfMissing = true)
@RequestMapping("/api/internal/e2e/bid-settlement")
class E2eBidSettlementControlController {
    private final KafkaListenerEndpointRegistry registry;

    E2eBidSettlementControlController(KafkaListenerEndpointRegistry registry) {
        this.registry = registry;
    }

    @PostMapping("/stop")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    synchronized void stop(HttpServletRequest request) {
        settlement(request).stop();
    }

    @PostMapping("/start")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    synchronized void start(HttpServletRequest request) {
        settlement(request).start();
    }

    private MessageListenerContainer settlement(HttpServletRequest request) {
        if (!"127.0.0.1".equals(request.getRemoteAddr())
                || request.getHeader("Forwarded") != null || request.getHeader("X-Forwarded-For") != null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Loopback requests only");
        }
        MessageListenerContainer listener = registry.getListenerContainer(DirectBidCommandKafkaListener.LISTENER_ID);
        if (listener == null) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Settlement listener unavailable");
        return listener;
    }
}
