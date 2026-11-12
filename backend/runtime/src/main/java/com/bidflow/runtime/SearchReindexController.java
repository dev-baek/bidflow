package com.bidflow.runtime;

import com.bidflow.application.search.SearchIndexingService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/internal/search")
class SearchReindexController {
    private final SearchIndexingService indexingService;

    SearchReindexController(SearchIndexingService indexingService) {
        this.indexingService = indexingService;
    }

    @PostMapping("/reindex")
    ReindexResponse reindex(@RequestParam(defaultValue = "100") int pageSize) {
        return new ReindexResponse(indexingService.reindexAll(pageSize));
    }

    record ReindexResponse(int indexedCount) {
    }
}
