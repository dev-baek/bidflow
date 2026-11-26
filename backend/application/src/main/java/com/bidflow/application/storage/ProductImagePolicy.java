package com.bidflow.application.storage;

import java.util.Set;

public final class ProductImagePolicy {
    private static final Set<String> CONTENT_TYPES = Set.of("image/jpeg", "image/png", "image/webp");
    private static final long MAX_BYTES = 10L * 1024 * 1024;

    private ProductImagePolicy() { }

    public static boolean allowsContentType(String contentType) {
        return contentType != null && CONTENT_TYPES.contains(contentType);
    }

    public static boolean allowsLength(long length) {
        return length > 0 && length <= MAX_BYTES;
    }

    public static boolean accepts(StoredObject object) {
        return allowsContentType(object.contentType()) && allowsLength(object.contentLength());
    }
}
