package com.bidflow.runtime;
import com.bidflow.application.bid.*;
import java.util.UUID;
import java.util.Map;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auctions")
class BidRequestController {
    private static final Logger log = LoggerFactory.getLogger(BidRequestController.class);
    private final BidRequestIdempotencyService service;
    BidRequestController(BidRequestIdempotencyService service) { this.service = service; }
    @PostMapping("/{auctionId}/bid-requests")
    @ResponseStatus(HttpStatus.ACCEPTED)
    Response create(Principal actor, @RequestHeader("Idempotency-Key") String key, @PathVariable UUID auctionId, @RequestBody Request request) {
        if (key.isBlank()) throw new IllegalArgumentException("invalid request headers");
        BidRequestValidation.validate(new BidRequestCommand(auctionId, request.bidKind(), request.amount()));
        String correlationId = MDC.get("correlationId");
        if (correlationId == null) correlationId = java.util.UUID.randomUUID().toString();
        UUID bidRequestId = service.receive(actor.getName(), key, correlationId, new BidRequestCommand(auctionId, request.bidKind(), request.amount()));
        try (LogContext.Scope ignored = LogContext.fields(Map.of("event", "bid.request.received", "bidRequestId", bidRequestId.toString(), "auctionId", auctionId.toString(), "outcome", "RECEIVED"))) {
            log.info("bid request received");
        }
        return new Response(bidRequestId, "RECEIVED");
    }
    record Request(String bidKind, long amount) {}
    record Response(UUID bidRequestId, String status) {}
    @ExceptionHandler(IllegalArgumentException.class) @ResponseStatus(HttpStatus.BAD_REQUEST) Error invalid() { return new Error("INVALID_BID_REQUEST"); }
    record Error(String code) {}
}
