package com.bidflow.runtime;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class CorrelationIdFilter extends OncePerRequestFilter {
    private final Supplier<String> ids;

    CorrelationIdFilter() {
        this(() -> UUID.randomUUID().toString());
    }

    CorrelationIdFilter(Supplier<String> ids) {
        this.ids = ids;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String correlationId = CorrelationId.resolve(request.getHeader("X-Correlation-Id"), ids);
        response.setHeader("X-Correlation-Id", correlationId);
        try (LogContext.Scope ignored = LogContext.request(correlationId)) {
            filterChain.doFilter(request, response);
        }
    }
}
