package com.bidflow.runtime;

import static org.mockito.Mockito.when;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.bidflow.application.auction.AuctionDetailSnapshot;
import com.bidflow.application.auction.AuctionDetailSnapshotReader;
import com.bidflow.application.auction.PrivateAuctionOutcome;
import com.bidflow.application.auction.PrivateAuctionOutcomeReader;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest({AuctionDetailController.class, PrivateAuctionOutcomeController.class})
@Import(LocalHttpSecurityConfiguration.class)
@ActiveProfiles("local")
class PrivateAuctionOutcomeHttpTest {
    private static final UUID AUCTION_ID = UUID.randomUUID();
    private static final String PUBLIC = "/api/v1/auctions/" + AUCTION_ID;
    private static final String PRIVATE = "/api/v1/me/auctions/" + AUCTION_ID + "/outcome";

    @Autowired MockMvc mvc;
    @MockitoBean AuctionDetailSnapshotReader snapshots;
    @MockitoBean PrivateAuctionOutcomeReader outcomes;

    @Test
    void rejectsAnonymousLookupWithoutMakingPublicDetailPrivate() throws Exception {
        when(snapshots.findByAuctionId(AUCTION_ID)).thenReturn(Optional.of(new AuctionDetailSnapshot(
                AUCTION_ID, "카메라", null, 21_000, Instant.parse("2030-01-01T12:35:00Z"), "ENDED", 3, "SOLD", 21_000L)));

        mvc.perform(get(PRIVATE)).andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(get(PUBLIC)).andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("SOLD"))
                .andExpect(jsonPath("$.winnerId").doesNotExist())
                .andExpect(jsonPath("$.privateOutcome").doesNotExist());
    }

    @Test
    void readsOnlyTheAuthenticatedViewerAndDisallowsCaching() throws Exception {
        when(outcomes.findForViewer(AUCTION_ID, "bidder-a")).thenReturn(Optional.of(PrivateAuctionOutcome.WON));
        when(outcomes.findForViewer(AUCTION_ID, "bidder-b")).thenReturn(Optional.of(PrivateAuctionOutcome.LOST));

        mvc.perform(get(PRIVATE).header("X-Actor-Id", "bidder-a"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(content().json("{\"auctionId\":\"" + AUCTION_ID + "\",\"outcome\":\"WON\"}", JsonCompareMode.STRICT));
        mvc.perform(get(PRIVATE).header("X-Actor-Id", "bidder-b").queryParam("bidderId", "bidder-a"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"auctionId\":\"" + AUCTION_ID + "\",\"outcome\":\"LOST\"}", JsonCompareMode.STRICT));
    }

    @Test
    void returnsNotFoundAndDisallowsCachingForAuthenticatedViewer() throws Exception {
        when(outcomes.findForViewer(AUCTION_ID, "bidder-a")).thenReturn(Optional.empty());
        mvc.perform(get(PRIVATE).header("X-Actor-Id", "bidder-a"))
                .andExpect(status().isNotFound())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.code").value("AUCTION_NOT_FOUND"));
    }
}
