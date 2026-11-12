package com.bidflow.application.listing;

import java.util.Optional;

public interface ListingRegistrationRepository {
    Optional<IdempotencyRecord> findIdempotency(String sellerId, String idempotencyKey);

    void save(NewListingRegistration registration);
}
