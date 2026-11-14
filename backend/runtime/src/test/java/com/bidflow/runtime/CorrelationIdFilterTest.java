package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class CorrelationIdFilterTest {
    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void keepsAValidClientCorrelationIdForTheRequestAndResponse() throws Exception {
        CorrelationIdFilter filter = new CorrelationIdFilter(() -> "generated-1");
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auctions/1/bid-requests");
        request.addHeader("X-Correlation-Id", "load-run-001");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> observed = new AtomicReference<>();

        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> observed.set(MDC.get("correlationId")));

        assertThat(observed.get()).isEqualTo("load-run-001");
        assertThat(response.getHeader("X-Correlation-Id")).isEqualTo("load-run-001");
        assertThat(MDC.get("correlationId")).isNull();
    }

    @Test
    void replacesAnInvalidClientCorrelationIdAndDoesNotLeakPreviousRequestContext() throws Exception {
        MDC.put("correlationId", "previous-request");
        CorrelationIdFilter filter = new CorrelationIdFilter(() -> "generated-1");
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/actuator/health");
        request.addHeader("X-Correlation-Id", "contains spaces");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> observed = new AtomicReference<>();

        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> observed.set(MDC.get("correlationId")));

        assertThat(observed.get()).isEqualTo("generated-1");
        assertThat(response.getHeader("X-Correlation-Id")).isEqualTo("generated-1");
        assertThat(MDC.get("correlationId")).isNull();
    }
}
