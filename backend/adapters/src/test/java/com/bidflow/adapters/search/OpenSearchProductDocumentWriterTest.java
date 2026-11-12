package com.bidflow.adapters.search;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.search.ProductSearchDocument;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OpenSearchProductDocumentWriterTest {

    @Test
    void upsertsTheCompleteDocumentThroughTheWriteAlias() throws Exception {
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/", exchange -> {
            method.set(exchange.getRequestMethod());
            path.set(exchange.getRequestURI().getPath());
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(201, -1);
            exchange.close();
        });
        server.start();
        try {
            UUID productId = UUID.fromString("00000000-0000-0000-0000-000000000001");
            new OpenSearchProductDocumentWriter(HttpClient.newHttpClient(), URI.create("http://localhost:" + server.getAddress().getPort()))
                    .upsert(new ProductSearchDocument(
                            productId, UUID.fromString("00000000-0000-0000-0000-000000000002"), "seller-1", "중고 \"카메라\"", "DIGITAL", "GOOD", null,
                            50_000L, 55_000L, "ACTIVE", true,
                            Instant.parse("2026-11-12T00:00:00Z"), Instant.parse("2026-11-12T01:00:00Z"), 1L, 2L,
                            Instant.parse("2026-11-12T00:10:00Z")));

            assertThat(method.get()).isEqualTo("PUT");
            assertThat(path.get()).isEqualTo("/bidflow-products-write/_doc/" + productId);
            assertThat(body.get()).contains("\"title\":\"중고 \\\"카메라\\\"\"")
                    .contains("\"thumbnailObjectKey\":null")
                    .contains("\"auctionVersion\":2");
        } finally {
            server.stop(0);
        }
    }
}
