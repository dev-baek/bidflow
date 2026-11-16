package com.bidflow.adapters.search;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.search.SearchListingsQuery;
import com.bidflow.application.search.SearchSort;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class OpenSearchProductSearchReaderTest {
    @Test
    void readsAuctionIdsWithoutDroppingLegacyDocuments() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        UUID auctionId = UUID.randomUUID();
        var current = mapper.createObjectNode().put("productId", UUID.randomUUID().toString())
                .put("title", "카메라").put("categoryId", "DIGITAL").putNull("thumbnailObjectKey")
                .put("currentPrice", 10_000).put("status", "ACTIVE").put("endsAt", "2030-01-01T12:30:00Z");
        var legacy = current.deepCopy().put("productId", UUID.randomUUID().toString());
        current.put("auctionId", auctionId.toString());
        var root = mapper.createObjectNode();
        var hits = root.putObject("hits").putArray("hits");
        hits.addObject().set("_source", current);
        hits.addObject().set("_source", legacy);
        byte[] response = mapper.writeValueAsBytes(root);
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/bidflow-products-read/_search", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(200, response.length);
            try (var body = exchange.getResponseBody()) { body.write(response); }
        });
        server.start();
        try {
            var reader = new OpenSearchProductSearchReader(HttpClient.newHttpClient(),
                    URI.create("http://localhost:" + server.getAddress().getPort()), mapper);
            var query = new SearchListingsQuery("", Optional.empty(), Optional.empty(), Optional.empty(),
                    Optional.empty(), Optional.empty(), SearchSort.RELEVANCE, 20, Optional.empty());
            var page = reader.search(query);

            assertThat(requestBody.get()).contains("\"auctionId\"");
            assertThat(page.items()).extracting("auctionId").containsExactly(auctionId, null);
        } finally {
            server.stop(0);
        }
    }
}
