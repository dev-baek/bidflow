package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcProductSearchDocumentSource;
import com.bidflow.adapters.search.OpenSearchProductDocumentWriter;
import com.bidflow.application.search.ProductSearchDocumentSource;
import com.bidflow.application.search.ProductSearchDocumentWriter;
import com.bidflow.application.search.SearchIndexingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.URI;
import java.net.http.HttpClient;

@Configuration
class SearchConfiguration {
    @Bean ProductSearchDocumentSource productSearchDocumentSource(JdbcTemplate jdbc) { return new JdbcProductSearchDocumentSource(jdbc); }
    @Bean ProductSearchDocumentWriter productSearchDocumentWriter(@Value("${bidflow.search.endpoint}") String endpoint) {
        return new OpenSearchProductDocumentWriter(HttpClient.newHttpClient(), URI.create(endpoint));
    }
    @Bean SearchIndexingService searchIndexingService(ProductSearchDocumentSource source, ProductSearchDocumentWriter writer) {
        return new SearchIndexingService(source, writer);
    }
}
