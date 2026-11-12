package com.bidflow.application.listing;

import java.util.UUID;

public record ListingImageRegistration(UUID imageId, String objectKey, int displayOrder) {
}
