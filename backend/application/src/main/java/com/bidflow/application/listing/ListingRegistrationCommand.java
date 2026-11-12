package com.bidflow.application.listing;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public record ListingRegistrationCommand(
        String idempotencyKey,
        String title,
        String description,
        String categoryId,
        String conditionGrade,
        long startingPrice,
        Instant startsAt,
        Instant endsAt,
        List<UUID> uploadIds
) {
    public ListingRegistrationCommand {
        idempotencyKey = requireText(idempotencyKey, "idempotencyKey");
        title = Objects.requireNonNull(title, "title must not be null");
        description = Objects.requireNonNull(description, "description must not be null");
        categoryId = Objects.requireNonNull(categoryId, "categoryId must not be null");
        conditionGrade = Objects.requireNonNull(conditionGrade, "conditionGrade must not be null");
        startsAt = Objects.requireNonNull(startsAt, "startsAt must not be null");
        endsAt = Objects.requireNonNull(endsAt, "endsAt must not be null");
        uploadIds = List.copyOf(Objects.requireNonNull(uploadIds, "uploadIds must not be null"));
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
