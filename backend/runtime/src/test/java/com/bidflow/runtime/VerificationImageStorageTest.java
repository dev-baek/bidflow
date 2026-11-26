package com.bidflow.runtime;

import com.bidflow.application.listing.IdentifierGenerator;
import com.bidflow.application.listing.ListingRegistrationService;
import com.bidflow.application.listing.UploadNotReadyException;
import com.bidflow.application.storage.PresignUploadCommand;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class VerificationImageStorageTest {
    @Test
    void missingVerificationBucketNeverFallsBackToLocalStorage() {
        var storage = new ListingConfiguration().verificationObjectStorage("", "");
        var command = new PresignUploadCommand("seller-1", "image/png", 5, UUID.randomUUID(), Instant.now());

        assertThatThrownBy(() -> storage.presignUpload(command))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        assertThatThrownBy(() -> storage.headObject("products/seller-1/test")).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void invalidUploadMetadataMapsToTheExistingRegistrationConflictContract() throws Exception {
        var registration = mock(ListingRegistrationService.class);
        when(registration.register(any(), any(), any(), any())).thenThrow(new UploadNotReadyException());
        var mvc = MockMvcBuilders.standaloneSetup(new ListingController(registration, mock(IdentifierGenerator.class), Clock.systemUTC())).build();
        mvc.perform(post("/api/v1/listings").principal(() -> "seller-1")
                        .header("Idempotency-Key", "first")
                        .contentType("application/json")
                        .content("""
                                {"title":"Camera","description":"A camera","categoryId":"DIGITAL","conditionGrade":"GOOD",
                                "startingPrice":1000,"startsAt":"2026-11-26T01:00:00Z","endsAt":"2026-11-26T02:00:00Z",
                                "images":[{"uploadId":"00000000-0000-0000-0000-000000000010"}]}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("UPLOAD_NOT_READY"));
    }
}
