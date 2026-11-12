package com.bidflow.application.listing;

import java.util.UUID;

@FunctionalInterface
public interface IdentifierGenerator {
    UUID nextUuid();
}
