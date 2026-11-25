package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.StompWebSocketEndpointRegistration;
import org.springframework.web.socket.server.HandshakeInterceptor;

class VerificationWebConfigurationTest {
    private static final String ALLOWED = "https://d123example.cloudfront.net";

    @ParameterizedTest
    @ValueSource(strings = {"", "http://d123example.cloudfront.net", "https://*.cloudfront.net",
            "https://d123example.cloudfront.net/", "https://d123example.cloudfront.net:443",
            "https://d123example.cloudfront.net?x=1", "https://d123example.cloudfront.net#fragment",
            "https://localhost", "https://d123example.cloudfront.net,https://d2.cloudfront.net"})
    void rejectsNonCanonicalOrMissingVerificationOrigin(String origin) {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new VerificationWebConfiguration(origin, new MockEnvironment()))
                .withMessageContaining("exact HTTPS CloudFront origin");
    }

    @ParameterizedTest
    @ValueSource(strings = {"local", "e2e"})
    void rejectsMixedVerificationAndTestProfiles(String otherProfile) {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("verification", otherProfile);
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new VerificationWebConfiguration(ALLOWED, environment))
                .withMessageContaining("cannot run with local or e2e");
    }

    @Test
    void requiresOneMatchingOriginOnTheRegisteredWebSocketUpgrade() throws Exception {
        var registry = mock(StompEndpointRegistry.class);
        var registration = mock(StompWebSocketEndpointRegistration.class);
        when(registry.addEndpoint("/ws")).thenReturn(registration);
        when(registration.setAllowedOrigins(ALLOWED)).thenReturn(registration);
        var verification = new VerificationWebConfiguration(ALLOWED, new MockEnvironment());
        webSocket(Optional.of(verification)).registerStompEndpoints(registry);

        var interceptor = ArgumentCaptor.forClass(HandshakeInterceptor.class);
        verify(registration).addInterceptors(interceptor.capture());
        checkUpgrade(interceptor.getValue(), true, ALLOWED);
        checkUpgrade(interceptor.getValue(), false);
        checkUpgrade(interceptor.getValue(), false, "https://api.example.test");
        checkUpgrade(interceptor.getValue(), false, "https://dnotours.cloudfront.net");
        checkUpgrade(interceptor.getValue(), false, ALLOWED, ALLOWED);
    }

    @Test
    void preservesLocalWebSocketOriginPatternsWithoutVerification() {
        var registry = mock(StompEndpointRegistry.class);
        var registration = mock(StompWebSocketEndpointRegistration.class);
        when(registry.addEndpoint("/ws")).thenReturn(registration);
        webSocket(Optional.empty()).registerStompEndpoints(registry);
        verify(registration).setAllowedOriginPatterns("http://localhost:5173");
    }

    private static RealtimeWebSocketConfiguration webSocket(Optional<VerificationWebConfiguration> verification) {
        return new RealtimeWebSocketConfiguration(mock(WebSocketAuthenticationInterceptor.class),
                mock(ThreadPoolTaskScheduler.class), new String[] {"http://localhost:5173"}, verification);
    }

    private static void checkUpgrade(HandshakeInterceptor interceptor, boolean allowed, String... origins) throws Exception {
        var request = new MockHttpServletRequest("GET", "/ws");
        request.setScheme("https");
        request.setServerName("api.example.test");
        request.setServerPort(443);
        for (String origin : origins) request.addHeader(HttpHeaders.ORIGIN, origin);
        var response = new MockHttpServletResponse();
        assertThat(interceptor.beforeHandshake(new ServletServerHttpRequest(request), new ServletServerHttpResponse(response),
                mock(WebSocketHandler.class), Map.of())).isEqualTo(allowed);
        if (!allowed) assertThat(response.getStatus()).isEqualTo(403);
    }
}
