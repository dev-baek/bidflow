package com.bidflow.application.search;

import java.time.Instant;
import java.util.Optional;

public record SearchListingsQuery(
        String keyword,
        Optional<String> categoryId,
        Optional<String> status,
        Optional<Long> minPrice,
        Optional<Long> maxPrice,
        Optional<Instant> endsBefore,
        SearchSort sort,
        int size,
        Optional<String> cursor
) {
}
