package com.bidflow.application.bid;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;
public final class BidRequestIdempotencyService {
    private final BidRequestRepository repository; private final Supplier<UUID> ids;
    public BidRequestIdempotencyService(BidRequestRepository repository, Supplier<UUID> ids) { this.repository = repository; this.ids = ids; }
    public UUID receive(String bidderId, String key, String correlationId, BidRequestCommand command) {
        String hash = hash(command);
        return repository.find(bidderId, key, hash).orElseGet(() -> { UUID id = ids.get(); repository.save(bidderId, key, hash, correlationId, id, command); return id; });
    }
    private static String hash(BidRequestCommand command) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((command.auctionId()+"|"+command.bidKind()+"|"+command.amount()).getBytes(StandardCharsets.UTF_8))); } catch (Exception exception) { throw new IllegalStateException(exception); } }
}
