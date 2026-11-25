package com.bidflow.runtime;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.bidflow.application.auction.PrivateAuctionOutcome;
import com.bidflow.application.auction.PrivateAuctionOutcomeReader;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = PrivateAuctionOutcomeController.class,
        properties = "bidflow.verification.web-origin=https://d123example.cloudfront.net")
@Import(CognitoHttpSecurityConfiguration.class)
@ActiveProfiles("verification")
class VerificationCorsHttpTest {
    private static final String ORIGIN = "https://d123example.cloudfront.net";
    private static final UUID AUCTION_ID = UUID.fromString("441938ee-ae46-42f2-a6ca-cd7c643ea723");
    private static final String OUTCOME = "/api/v1/me/auctions/" + AUCTION_ID + "/outcome";

    @Autowired MockMvc mvc;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean PrivateAuctionOutcomeReader outcomes;

    @Test
    void allowsCloudFrontPreflightWithoutCredentialsButStillRequiresBearerForTheRequest() throws Exception {
        mvc.perform(options(OUTCOME).header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Authorization, Content-Type, Idempotency-Key"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN))
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));

        mvc.perform(get(OUTCOME).header(HttpHeaders.ORIGIN, ORIGIN).header("X-Actor-Id", "not-a-principal"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN));

        when(decoder.decode("mock-access-token")).thenReturn(Jwt.withTokenValue("mock-access-token")
                .header("alg", "RS256").subject("bidder-a").build());
        when(outcomes.findForViewer(AUCTION_ID, "bidder-a")).thenReturn(Optional.of(PrivateAuctionOutcome.WON));
        mvc.perform(get(OUTCOME).header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer mock-access-token"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN))
                .andExpect(jsonPath("$.outcome").value("WON"));
    }

    @Test
    void deniesOtherOriginsDeveloperHeaderAndUnsupportedMethods() throws Exception {
        mvc.perform(options(OUTCOME).header(HttpHeaders.ORIGIN, "https://dnotours.cloudfront.net")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        mvc.perform(options(OUTCOME).header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "X-Actor-Id"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        mvc.perform(options(OUTCOME).header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "DELETE"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void neverGrantsBrowserCorsToInternalOrActuatorPaths() throws Exception {
        for (String path : new String[] {"/api/internal/search/reindex", "/actuator/health/readiness"}) {
            mvc.perform(options(path).header(HttpHeaders.ORIGIN, ORIGIN)
                            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                    .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        }
    }
}
