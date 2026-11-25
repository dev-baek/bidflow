package com.bidflow.runtime;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.StompWebSocketEndpointRegistration;
import org.springframework.web.socket.server.support.OriginHandshakeInterceptor;

@Configuration(proxyBeanMethods = false)
@Profile("verification")
class VerificationWebConfiguration implements WebMvcConfigurer {
    private static final Pattern CLOUDFRONT_ORIGIN = Pattern.compile("https://d[a-z0-9]{1,62}\\.cloudfront\\.net");
    private final String origin;

    VerificationWebConfiguration(@Value("${bidflow.verification.web-origin:}") String origin, Environment environment) {
        if (environment.matchesProfiles("local", "e2e")) {
            throw new IllegalArgumentException("verification cannot run with local or e2e profiles");
        }
        if (!CLOUDFRONT_ORIGIN.matcher(origin).matches()) {
            throw new IllegalArgumentException("bidflow.verification.web-origin must be an exact HTTPS CloudFront origin");
        }
        this.origin = origin;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/v1/**")
                .allowedOrigins(origin)
                .allowedMethods("GET", "POST")
                .allowedHeaders("Authorization", "Content-Type", "Idempotency-Key")
                .allowCredentials(false);
    }

    void restrictUpgrade(StompWebSocketEndpointRegistration registration) {
        registration.setAllowedOrigins(origin).addInterceptors(new OriginHandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                    WebSocketHandler handler, Map<String, Object> attributes) {
                // Verification accepts only the configured browser origin, even for same-origin requests to the API.
                if (List.of(origin).equals(request.getHeaders().get(HttpHeaders.ORIGIN))) return true;
                response.setStatusCode(HttpStatus.FORBIDDEN);
                return false;
            }
        });
    }
}
