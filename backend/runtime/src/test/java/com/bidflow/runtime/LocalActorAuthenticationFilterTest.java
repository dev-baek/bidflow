package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class LocalActorAuthenticationFilterTest {
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void mapsTheLocalOnlyHeaderToAnAuthenticatedPrincipalForOneRequest() throws Exception {
        LocalActorAuthenticationFilter filter = new LocalActorAuthenticationFilter();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/listings");
        request.addHeader("X-Actor-Id", "local-seller");
        AtomicReference<String> actor = new AtomicReference<>();

        filter.doFilter(request, new MockHttpServletResponse(), (ignoredRequest, ignoredResponse) ->
                actor.set(SecurityContextHolder.getContext().getAuthentication().getName()));

        assertThat(actor.get()).isEqualTo("local-seller");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void ignoresAWhitespaceOnlyLocalActorHeader() throws Exception {
        LocalActorAuthenticationFilter filter = new LocalActorAuthenticationFilter();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/listings");
        request.addHeader("X-Actor-Id", " ");
        AtomicReference<Object> authentication = new AtomicReference<>();

        filter.doFilter(request, new MockHttpServletResponse(), (ignoredRequest, ignoredResponse) ->
                authentication.set(SecurityContextHolder.getContext().getAuthentication()));

        assertThat(authentication.get()).isNull();
    }
}
