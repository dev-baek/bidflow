package com.bidflow.application.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class SearchListingsServiceTest {

    @Test
    void delegatesAValidKeywordFilterAndSortQueryToTheReadModel() {
        CapturingReader reader = new CapturingReader();
        SearchListingsService service = new SearchListingsService(reader);
        SearchListingsQuery query = new SearchListingsQuery(
                " camera ", Optional.of("DIGITAL"), Optional.of("ACTIVE"), Optional.of(50_000L), Optional.of(200_000L),
                Optional.of(Instant.parse("2026-11-13T00:00:00Z")), SearchSort.ENDING_SOON, 20, Optional.empty());

        SearchListingsPage page = service.search(query);

        assertThat(reader.received).isEqualTo(query);
        assertThat(page.items()).isEmpty();
    }

    @Test
    void rejectsAnInvalidPriceRangeBeforeReadingOpenSearch() {
        CapturingReader reader = new CapturingReader();
        SearchListingsService service = new SearchListingsService(reader);
        SearchListingsQuery query = new SearchListingsQuery(
                "", Optional.empty(), Optional.empty(), Optional.of(100_000L), Optional.of(50_000L),
                Optional.empty(), SearchSort.RELEVANCE, 20, Optional.empty());

        assertThatThrownBy(() -> service.search(query)).isInstanceOf(InvalidSearchQueryException.class);
        assertThat(reader.received).isNull();
    }

    private static final class CapturingReader implements ProductSearchReader {
        private SearchListingsQuery received;
        @Override public SearchListingsPage search(SearchListingsQuery query) {
            received = query;
            return new SearchListingsPage(java.util.List.of(), Optional.empty());
        }
    }
}
