package com.bidflow.application.search;

import java.util.Set;

public final class SearchListingsService {
    private static final Set<String> CATEGORIES = Set.of("DIGITAL", "FASHION", "HOBBY", "LIVING");
    private static final Set<String> STATUSES = Set.of("SCHEDULED", "ACTIVE");
    private final ProductSearchReader reader;

    public SearchListingsService(ProductSearchReader reader) {
        this.reader = reader;
    }

    public SearchListingsPage search(SearchListingsQuery query) {
        validate(query);
        return reader.search(query);
    }

    private static void validate(SearchListingsQuery query) {
        if (query.keyword() == null || query.keyword().trim().length() > 100) throw new InvalidSearchQueryException("invalid keyword");
        if (query.categoryId().isPresent() && !CATEGORIES.contains(query.categoryId().get())) throw new InvalidSearchQueryException("invalid category");
        if (query.status().isPresent() && !STATUSES.contains(query.status().get())) throw new InvalidSearchQueryException("invalid status");
        if (query.minPrice().isPresent() && query.minPrice().get() < 0 || query.maxPrice().isPresent() && query.maxPrice().get() < 0
                || query.minPrice().isPresent() && query.maxPrice().isPresent() && query.minPrice().get() > query.maxPrice().get()) throw new InvalidSearchQueryException("invalid price range");
        if (query.size() < 1 || query.size() > 50) throw new InvalidSearchQueryException("invalid page size");
    }
}
