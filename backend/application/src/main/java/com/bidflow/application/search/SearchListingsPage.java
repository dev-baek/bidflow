package com.bidflow.application.search;

import java.util.List;
import java.util.Optional;

public record SearchListingsPage(List<SearchListingItem> items, Optional<String> nextCursor) {
    public SearchListingsPage {
        items = List.copyOf(items);
    }
}
