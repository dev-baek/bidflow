package com.bidflow.application.listing;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.domain.listing.Auction;
import com.bidflow.domain.listing.AuctionDraft;
import com.bidflow.domain.listing.ConditionGrade;
import com.bidflow.domain.listing.ListingAuctionRules;
import com.bidflow.domain.listing.ProductDraft;
import com.bidflow.domain.listing.ProductStatus;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

public final class ListingRegistrationService {
    private final ListingRegistrationRepository repository;
    private final ObjectStorage objectStorage;

    public ListingRegistrationService(ListingRegistrationRepository repository, ObjectStorage objectStorage) {
        this.repository = repository;
        this.objectStorage = objectStorage;
    }

    public ListingRegistrationResult register(
            ListingRegistrationCommand command,
            String sellerId,
            Instant now,
            IdentifierGenerator identifiers
    ) {
        String payloadHash = payloadHash(command);
        var existing = repository.findIdempotency(sellerId, command.idempotencyKey());
        if (existing.isPresent()) {
            if (!existing.get().payloadHash().equals(payloadHash)) {
                throw new IdempotencyConflictException();
            }
            return existing.get().result();
        }

        List<String> objectKeys = command.uploadIds().stream()
                .map(uploadId -> "products/" + sellerId + "/" + uploadId)
                .toList();
        if (objectKeys.stream().anyMatch(key -> objectStorage.headObject(key).isEmpty())) {
            throw new UploadNotReadyException();
        }

        ProductDraft product = new ProductDraft(
                command.title(), command.description(), command.categoryId(), ConditionGrade.valueOf(command.conditionGrade()), objectKeys
        );
        if (!ListingAuctionRules.validateProduct(product).isSuccess()) {
            throw new IllegalArgumentException("invalid product");
        }
        UUID productId = identifiers.nextUuid();
        UUID auctionId = identifiers.nextUuid();
        Auction auction = ListingAuctionRules.createAuction(
                ProductStatus.PUBLISHED,
                new AuctionDraft(auctionId, productId, sellerId, command.startingPrice(), command.startsAt(), command.endsAt()),
                now
        ).value().orElseThrow(() -> new IllegalArgumentException("invalid auction"));
        ListingRegistrationResult result = new ListingRegistrationResult(productId, auctionId, auction.status().name());
        List<ListingImageRegistration> images = IntStream.range(0, objectKeys.size())
                .mapToObj(index -> new ListingImageRegistration(identifiers.nextUuid(), objectKeys.get(index), index))
                .toList();
        OutboxRegistration outbox = new OutboxRegistration(
                identifiers.nextUuid(), productId, "ListingPublished",
                "{\"productId\":\"" + productId + "\",\"sellerId\":\"" + sellerId + "\"}", now
        );
        repository.save(new NewListingRegistration(sellerId, command.idempotencyKey(), payloadHash, result, product, auction, images, outbox));
        return result;
    }

    private static String payloadHash(ListingRegistrationCommand command) {
        String value = String.join("|", command.title().trim(), command.description().trim(), command.categoryId(), command.conditionGrade(),
                Long.toString(command.startingPrice()), command.startsAt().toString(), command.endsAt().toString(), command.uploadIds().toString());
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
