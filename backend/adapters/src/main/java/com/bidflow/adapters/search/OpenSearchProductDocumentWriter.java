package com.bidflow.adapters.search;

import com.bidflow.application.search.ProductSearchDocument;
import com.bidflow.application.search.ProductSearchDocumentWriter;

public final class OpenSearchProductDocumentWriter implements ProductSearchDocumentWriter {
    private final OpenSearchTransport transport;

    public OpenSearchProductDocumentWriter(OpenSearchTransport transport) {
        this.transport = transport;
    }

    @Override
    public void upsert(ProductSearchDocument document) {
        try {
            var response = transport.execute("PUT", "/bidflow-products-write/_doc/" + document.productId(), json(document));
            if (!response.successful()) {
                throw new IllegalStateException("OpenSearch document upsert failed: " + response.status());
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
                + "\",\"auctionId\":\"" + document.auctionId()
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
