package com.bidflow.application.search;

public interface ProductSearchDocumentWriter {
    void upsert(ProductSearchDocument document);
}
