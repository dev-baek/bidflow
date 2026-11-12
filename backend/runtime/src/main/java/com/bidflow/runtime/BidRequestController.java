package com.bidflow.runtime;
import com.bidflow.application.bid.*;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auctions")
class BidRequestController {
    @PostMapping("/{auctionId}/bid-requests")
    @ResponseStatus(HttpStatus.ACCEPTED)
    Response create(@RequestHeader("X-Actor-Id") String actorId, @RequestHeader("Idempotency-Key") String key, @PathVariable UUID auctionId, @RequestBody Request request) {
        if (actorId.isBlank() || key.isBlank()) throw new IllegalArgumentException("invalid request headers");
        BidRequestValidation.validate(new BidRequestCommand(auctionId, request.bidKind(), request.amount()));
        return new Response(UUID.randomUUID(), "RECEIVED");
    }
    record Request(String bidKind, long amount) {}
    record Response(UUID bidRequestId, String status) {}
    @ExceptionHandler(IllegalArgumentException.class) @ResponseStatus(HttpStatus.BAD_REQUEST) Error invalid() { return new Error("INVALID_BID_REQUEST"); }
    record Error(String code) {}
}
