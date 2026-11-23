package com.bidflow.runtime;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class CorrelationIdFilter extends OncePerRequestFilter {
    private final Supplier<String> ids;
    private final boolean timingEnabled;
    private final LongSupplier clock;

    @Autowired
    CorrelationIdFilter(Environment environment, @Value("${bidflow.bid.ingress-timing:false}") boolean enabled) {
        this(() -> UUID.randomUUID().toString(),
                enabled && environment.getActiveProfiles().length == 1 && environment.matchesProfiles("local"),
                System::nanoTime);
    }

    CorrelationIdFilter(Supplier<String> ids) {
        this(ids, false, System::nanoTime);
    }

    CorrelationIdFilter(Supplier<String> ids, boolean timingEnabled, LongSupplier clock) {
        this.ids = ids;
        this.timingEnabled = timingEnabled;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        boolean measure = timingEnabled && BidIngressTiming.matches(request);
        var timing = measure ? new BidIngressTiming(clock) : null;
        String correlationId = CorrelationId.resolve(request.getHeader("X-Correlation-Id"), ids);
        response.setHeader("X-Correlation-Id", correlationId);
        try (LogContext.Scope ignored = LogContext.request(correlationId)) {
            if (timing == null || !BidIngressTiming.isDiagnosticId(correlationId)) {
                filterChain.doFilter(request, response);
                return;
            }
            request.setAttribute(BidIngressTiming.ATTRIBUTE, timing);
            boolean returned = false;
            try {
                filterChain.doFilter(request, response);
                returned = true;
            } finally {
                request.removeAttribute(BidIngressTiming.ATTRIBUTE);
                timing.log(returned, response.getStatus());
            }
        }
    }
}
