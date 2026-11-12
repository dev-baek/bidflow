package com.bidflow.runtime;

import com.bidflow.application.listing.IdentifierGenerator;
import com.bidflow.application.listing.ListingRegistrationCommand;
import com.bidflow.application.listing.ListingRegistrationResult;
import com.bidflow.application.listing.ListingRegistrationService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/listings")
class ListingController {
    private final ListingRegistrationService service; private final IdentifierGenerator ids;
    ListingController(ListingRegistrationService service, IdentifierGenerator ids) { this.service = service; this.ids = ids; }
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    ListingResponse create(@RequestHeader("X-Actor-Id") String actorId, @RequestHeader("Idempotency-Key") String key, @RequestBody CreateListingRequest request) {
        ListingRegistrationResult result = service.register(new ListingRegistrationCommand(key, request.title(), request.description(), request.categoryId(), request.conditionGrade(), request.startingPrice(), request.startsAt(), request.endsAt(), request.images().stream().map(ImageRequest::uploadId).toList()), actorId, Instant.now(), ids);
        return new ListingResponse(result.productId(), result.auctionId(), result.auctionStatus());
    }
    record CreateListingRequest(String title, String description, String categoryId, String conditionGrade, long startingPrice, Instant startsAt, Instant endsAt, List<ImageRequest> images) {}
    record ImageRequest(UUID uploadId) {}
    record ListingResponse(UUID productId, UUID auctionId, String status) {}
}
