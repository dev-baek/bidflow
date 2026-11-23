package com.bidflow.runtime;
import com.bidflow.application.bid.*;
import jakarta.servlet.http.HttpServletRequest;
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
    Response create(Principal actor, @RequestHeader("Idempotency-Key") String key, @PathVariable UUID auctionId,
            @RequestBody Request request, HttpServletRequest servletRequest) {
        if (key.isBlank()) throw new IllegalArgumentException("invalid request headers");
        var command = new BidRequestCommand(auctionId, request.bidKind(), request.amount());
        BidRequestValidation.validate(command);
        String correlationId = MDC.get("correlationId");
        if (correlationId == null) correlationId = java.util.UUID.randomUUID().toString();
        String bidder = actor.getName();
        var timing = (BidIngressTiming) servletRequest.getAttribute(BidIngressTiming.ATTRIBUTE);
        UUID bidRequestId = null;
        if (timing != null) timing.beginReceive();
        try {
            bidRequestId = service.receive(bidder, key, correlationId, command);
        } finally {
            if (timing != null) timing.endReceive(bidRequestId);
        }
        try (LogContext.Scope ignored = LogContext.fields(Map.of("event", "bid.request.received", "bidRequestId", bidRequestId.toString(), "auctionId", auctionId.toString(), "outcome", "RECEIVED"))) {
            log.info("bid request received");
        }
        return new Response(bidRequestId, "RECEIVED");
    }
    record Request(String bidKind, long amount) {}
    record Response(UUID bidRequestId, String status) {}
    @ExceptionHandler(IllegalArgumentException.class) @ResponseStatus(HttpStatus.BAD_REQUEST) Error invalid() { return new Error("INVALID_BID_REQUEST"); }
    @ExceptionHandler(BidRequestPayloadMismatchException.class) @ResponseStatus(HttpStatus.CONFLICT)
    Error payloadMismatch() { return new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"); }
    record Error(String code) {}
}
