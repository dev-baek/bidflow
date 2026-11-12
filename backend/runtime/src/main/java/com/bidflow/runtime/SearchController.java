package com.bidflow.runtime;

import com.bidflow.application.search.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/v1/listings/search")
class SearchController {
    private final SearchListingsService service;
    SearchController(SearchListingsService service) { this.service = service; }
    @GetMapping SearchResponse search(@RequestParam(defaultValue = "") String q, @RequestParam(required = false) String categoryId, @RequestParam(required = false) String status,
                                      @RequestParam(required = false) Long minPrice, @RequestParam(required = false) Long maxPrice, @RequestParam(required = false) Instant endsBefore,
                                      @RequestParam(defaultValue = "RELEVANCE") String sort, @RequestParam(defaultValue = "20") int size, @RequestParam(required = false) String cursor) {
        try { return response(service.search(new SearchListingsQuery(q, Optional.ofNullable(categoryId), Optional.ofNullable(status), Optional.ofNullable(minPrice), Optional.ofNullable(maxPrice), Optional.ofNullable(endsBefore), SearchSort.valueOf(sort), size, Optional.ofNullable(cursor)))); }
        catch (IllegalArgumentException exception) { throw new InvalidSearchQueryException("invalid search query"); }
    }
    private static SearchResponse response(SearchListingsPage page) { return new SearchResponse(page.items().stream().map(item -> new Item(item.productId(), item.title(), item.categoryId(), item.thumbnailObjectKey(), item.currentPrice(), item.status(), item.endsAt())).toList(), page.nextCursor().orElse(null)); }
    record SearchResponse(List<Item> items, String nextCursor) {}
    record Item(java.util.UUID productId, String title, String categoryId, String thumbnailObjectKey, long currentPrice, String status, Instant endsAt) {}
    @ExceptionHandler(InvalidSearchQueryException.class) @ResponseStatus(HttpStatus.BAD_REQUEST) ErrorResponse invalid(InvalidSearchQueryException exception) { return new ErrorResponse("INVALID_SEARCH_QUERY"); }
    @ExceptionHandler(SearchUnavailableException.class) @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE) ErrorResponse unavailable(SearchUnavailableException exception) { return new ErrorResponse("SEARCH_UNAVAILABLE"); }
    record ErrorResponse(String code) {}
}
