package com.bidflow.application.realtime;

import java.util.Objects;
import java.util.UUID;

/** A pre-sanitized WebSocket payload routed through Redis to every API instance. */
public record RealtimeMessage(UUID eventId, UUID auctionId, String recipientId, String payload) {
    public RealtimeMessage {
        Objects.requireNonNull(eventId, "eventId must not be null");
        Objects.requireNonNull(auctionId, "auctionId must not be null");
        if (payload == null || payload.isBlank()) throw new IllegalArgumentException("payload must not be blank");
    }

    public boolean hasRecipient() {
        return recipientId != null && !recipientId.isBlank();
    }
}
