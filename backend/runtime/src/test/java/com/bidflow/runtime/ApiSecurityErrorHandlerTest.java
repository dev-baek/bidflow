package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;

class ApiSecurityErrorHandlerTest {
    private final ApiSecurityErrorHandler handler = new ApiSecurityErrorHandler();

    @Test
    void returnsSafeDistinctResponsesForUnauthenticatedAndForbiddenRequests() throws Exception {
        MockHttpServletResponse unauthenticated = new MockHttpServletResponse();
        handler.commence(new MockHttpServletRequest(), unauthenticated, new AuthenticationException("raw-token-must-not-appear") { });

        MockHttpServletResponse forbidden = new MockHttpServletResponse();
        handler.handle(new MockHttpServletRequest(), forbidden, new AccessDeniedException("ownership details must not appear"));

        assertThat(unauthenticated.getStatus()).isEqualTo(401);
        assertThat(unauthenticated.getContentAsString()).isEqualTo("{\"code\":\"UNAUTHENTICATED\"}");
        assertThat(forbidden.getStatus()).isEqualTo(403);
        assertThat(forbidden.getContentAsString()).isEqualTo("{\"code\":\"FORBIDDEN\"}");
    }
}
