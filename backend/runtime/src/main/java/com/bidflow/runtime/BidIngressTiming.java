package com.bidflow.runtime;

import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class BidIngressTiming {
    static final String ATTRIBUTE = BidIngressTiming.class.getName();
    private static final Logger LOG = LoggerFactory.getLogger(BidIngressTiming.class);
    private static final String UUID_PATTERN = "(?i:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})";
    private static final Pattern UUID_TEXT = Pattern.compile(UUID_PATTERN);
    private static final Pattern ROUTE = Pattern.compile("/api/v1/auctions/" + UUID_PATTERN + "/bid-requests");

    private final LongSupplier clock;
    private final long started;
    private long receiveStart;
    private long receiveEnd;
    private boolean receiveObserved;
    private UUID requestId;

    BidIngressTiming(LongSupplier clock) {
        this.clock = clock;
        started = clock.getAsLong();
    }

    static boolean matches(HttpServletRequest request) {
        return "POST".equals(request.getMethod()) && ROUTE.matcher(request.getRequestURI()).matches();
    }

    static boolean isDiagnosticId(String correlationId) {
        return UUID_TEXT.matcher(correlationId).matches();
    }

    void beginReceive() {
        receiveStart = clock.getAsLong() - started;
    }

    void endReceive(UUID result) {
        receiveEnd = clock.getAsLong() - started;
        requestId = result;
        receiveObserved = true;
    }

    void log(boolean returned, int status) {
        long http = clock.getAsLong() - started;
        if (http < 0 || (receiveObserved && (receiveStart < 0 || receiveEnd < receiveStart || receiveEnd > http))) return;
        var fields = new HashMap<String, String>();
        fields.put("event", "bid.ingress.timing");
        fields.put("outcome", returned ? "HTTP_RETURNED" : "CHAIN_THREW");
        fields.put("httpNanos", Long.toString(http));
        if (returned) fields.put("httpStatus", Integer.toString(status));
        if (receiveObserved) {
            fields.put("receiveStartNanos", Long.toString(receiveStart));
            fields.put("receiveEndNanos", Long.toString(receiveEnd));
            fields.put("receiveOutcome", requestId == null ? "THREW" : "RETURNED");
        }
        if (requestId != null) fields.put("bidRequestId", requestId.toString());
        try (var scope = LogContext.fields(fields)) {
            LOG.info("bid ingress timing");
        } catch (RuntimeException ignored) { /* A logging failure must not change the response or original exception. */ }
    }
}
