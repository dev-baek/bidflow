package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcProductSearchDocumentSource;
import com.bidflow.adapters.search.AwsOpenSearchTransport;
import com.bidflow.adapters.search.OpenSearchProductDocumentWriter;
import com.bidflow.adapters.search.OpenSearchProductSearchReader;
import com.bidflow.adapters.search.OpenSearchTransport;
import com.bidflow.application.search.ProductSearchDocumentSource;
import com.bidflow.application.search.ProductSearchDocumentWriter;
import com.bidflow.application.search.SearchIndexingService;
import com.bidflow.application.search.ProductSearchReader;
import com.bidflow.application.search.SearchListingsService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.URI;
import java.net.http.HttpClient;

@Configuration
class SearchConfiguration {
    @Bean ProductSearchDocumentSource productSearchDocumentSource(JdbcTemplate jdbc) { return new JdbcProductSearchDocumentSource(jdbc); }
    @Bean OpenSearchTransport openSearchTransport(@Value("${bidflow.search.mode}") String mode,
                                                  @Value("${bidflow.search.endpoint}") String localEndpoint,
                                                  @Value("${bidflow.search.aws-endpoint}") String managedEndpoint,
                                                  @Value("${bidflow.search.aws-region}") String region) {
        return switch (mode) {
            case "local" -> OpenSearchTransport.local(HttpClient.newHttpClient(), URI.create(localEndpoint));
            case "aws" -> AwsOpenSearchTransport.create(managedEndpoint, region);
            default -> throw new IllegalArgumentException("Unknown OpenSearch mode.");
        };
    }
    @Bean ProductSearchDocumentWriter productSearchDocumentWriter(OpenSearchTransport transport) {
        return new OpenSearchProductDocumentWriter(transport);
    }
    @Bean SearchIndexingService searchIndexingService(ProductSearchDocumentSource source, ProductSearchDocumentWriter writer) {
        return new SearchIndexingService(source, writer);
    }
    @Bean ProductSearchReader productSearchReader(OpenSearchTransport transport, ObjectMapper objectMapper) {
        return new OpenSearchProductSearchReader(transport, objectMapper);
    }
    @Bean SearchListingsService searchListingsService(ProductSearchReader reader) { return new SearchListingsService(reader); }
}
