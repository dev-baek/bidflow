package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.bidflow.application.bid.BidRequestIdempotencyService;
import com.bidflow.application.bid.BidRequestPayloadMismatchException;
import jakarta.servlet.ServletException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.slf4j.LoggerFactory;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CorrelationIdFilterTest {
    private static final String ID = "00000000-0000-4000-8000-000000000001";
    private static final String BID_PATH = "/api/v1/auctions/" + ID + "/bid-requests";
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

    @Test
    void capturesNestedServiceWindowWithoutChangingHttpResponseOrMdc() throws Exception {
        var service = mock(BidRequestIdempotencyService.class);
        when(service.receive(anyString(), anyString(), anyString(), any()))
                .thenReturn(UUID.fromString(ID)).thenThrow(new BidRequestPayloadMismatchException());
        var clock = new AtomicLong(10);
        var filter = new CorrelationIdFilter(() -> ID, true, () -> clock.getAndAdd(10));
        var mvc = MockMvcBuilders.standaloneSetup(new BidRequestController(service)).addFilters(filter).build();
        try (var capture = new Capture()) {
            for (int expected : List.of(202, 409)) {
                mvc.perform(post(BID_PATH).principal(() -> "private-actor").contentType("application/json")
                        .header("Idempotency-Key", "private-key").content("{\"bidKind\":\"DIRECT\",\"amount\":11000}"))
                        .andExpect(status().is(expected));
                assertThat(MDC.getCopyOfContextMap()).isNull();
            }
            assertThat(capture.fields).hasSize(2);
            assertThat(capture.fields.getFirst()).containsExactlyInAnyOrderEntriesOf(Map.of(
                    "correlationId", ID, "bidRequestId", ID, "event", "bid.ingress.timing", "outcome", "HTTP_RETURNED",
                    "httpStatus", "202", "httpNanos", "30", "receiveStartNanos", "10", "receiveEndNanos", "20",
                    "receiveOutcome", "RETURNED"));
            assertThat(capture.fields.getLast()).containsEntry("httpStatus", "409").containsEntry("receiveOutcome", "THREW")
                    .doesNotContainKey("bidRequestId");
        }
    }

    @Test
    void skipsDisabledNonLocalAndOtherRoutesWithoutReadingClock() throws Exception {
        var clock = new AtomicLong();
        var env = new MockEnvironment();
        env.setActiveProfiles("prod", "local");
        try (var capture = new Capture()) {
            new CorrelationIdFilter(env, true).doFilter(new MockHttpServletRequest("POST", BID_PATH),
                    new MockHttpServletResponse(), (req, res) -> {});
            new CorrelationIdFilter(() -> ID, false, clock::incrementAndGet)
                    .doFilter(new MockHttpServletRequest("POST", BID_PATH), new MockHttpServletResponse(), (req, res) -> {});
            new CorrelationIdFilter(() -> ID, true, clock::incrementAndGet)
                    .doFilter(new MockHttpServletRequest("GET", BID_PATH), new MockHttpServletResponse(), (req, res) -> {});
            assertThat(clock.get()).isZero();
            assertThat(capture.fields).isEmpty();
        }
    }

    @Test
    void preservesThrownExceptionAndDoesNotClaimAnHttpStatus() throws Exception {
        var clock = new AtomicLong(20);
        var filter = new CorrelationIdFilter(() -> ID, true, () -> clock.getAndAdd(10));
        var failure = new ServletException("private-exception");
        try (var capture = new Capture()) {
            assertThatThrownBy(() -> filter.doFilter(new MockHttpServletRequest("POST", BID_PATH),
                    new MockHttpServletResponse(), (req, res) -> { throw failure; })).isSameAs(failure);
            assertThat(capture.fields).singleElement().satisfies(fields -> assertThat(fields)
                    .containsEntry("outcome", "CHAIN_THREW").containsEntry("httpNanos", "10")
                    .doesNotContainKeys("httpStatus", "bidRequestId", "receiveStartNanos"));
            assertThat(MDC.getCopyOfContextMap()).isNull();
        }
    }

    private static final class Capture extends AppenderBase<ILoggingEvent> implements AutoCloseable {
        private final Logger logger = (Logger) LoggerFactory.getLogger("com.bidflow.runtime.BidIngressTiming");
        private final List<Map<String, String>> fields = new ArrayList<>();
        Capture() { start(); logger.addAppender(this); }
        @Override protected void append(ILoggingEvent event) { fields.add(Map.copyOf(event.getMDCPropertyMap())); }
        @Override public void close() { logger.detachAppender(this); stop(); }
    }
}
