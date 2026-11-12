package com.bidflow.adapters.search;

import com.bidflow.application.search.ProductSearchDocument;
import com.bidflow.application.search.ProductSearchDocumentWriter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public final class OpenSearchProductDocumentWriter implements ProductSearchDocumentWriter {
    private final HttpClient client;
    private final URI endpoint;

    public OpenSearchProductDocumentWriter(HttpClient client, URI endpoint) {
        this.client = client;
        this.endpoint = endpoint;
    }

    @Override
    public void upsert(ProductSearchDocument document) {
        HttpRequest request = HttpRequest.newBuilder(endpoint.resolve("/bidflow-products-write/_doc/" + document.productId()))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json(document)))
                .build();
        try {
            int status = client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("OpenSearch document upsert failed: " + status);
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("OpenSearch document upsert interrupted", exception);
        } catch (Exception exception) {
            throw new IllegalStateException("OpenSearch document upsert failed", exception);
        }
    }

    private static String json(ProductSearchDocument document) {
        return "{\"productId\":\"" + document.productId()
                + "\",\"sellerId\":\"" + text(document.sellerId())
                + "\",\"title\":\"" + text(document.title())
                + "\",\"categoryId\":\"" + text(document.categoryId())
                + "\",\"conditionGrade\":\"" + text(document.conditionGrade())
                + "\",\"thumbnailObjectKey\":" + nullableText(document.thumbnailObjectKey())
                + ",\"startingPrice\":" + document.startingPrice()
                + ",\"currentPrice\":" + document.currentPrice()
                + ",\"status\":\"" + text(document.status())
                + "\",\"searchable\":" + document.searchable()
                + ",\"startsAt\":\"" + document.startsAt()
                + "\",\"endsAt\":\"" + document.endsAt()
                + "\",\"listingVersion\":" + document.listingVersion()
                + ",\"auctionVersion\":" + document.auctionVersion()
                + ",\"indexedAt\":\"" + document.indexedAt() + "\"}";
    }

    private static String nullableText(String value) {
        return value == null ? "null" : "\"" + text(value) + "\"";
    }

    private static String text(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
