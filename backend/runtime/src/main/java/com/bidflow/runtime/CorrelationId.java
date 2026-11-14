package com.bidflow.runtime;

import java.util.Objects;
import java.util.function.Supplier;
import java.util.regex.Pattern;

final class CorrelationId {
    private static final Pattern VALID = Pattern.compile("[A-Za-z0-9._-]{1,128}");

    private CorrelationId() {
    }

    static String resolve(String candidate, Supplier<String> generated) {
        Objects.requireNonNull(generated, "generated must not be null");
        return candidate != null && VALID.matcher(candidate).matches() ? candidate : generated.get();
    }
}
