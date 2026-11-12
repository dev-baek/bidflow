package com.bidflow.domain.listing;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

public record RuleResult<T, E>(Optional<T> value, List<E> violations) {
    public RuleResult {
        value = Objects.requireNonNull(value, "value must not be null");
        violations = List.copyOf(Objects.requireNonNull(violations, "violations must not be null"));
    }

    public static <T, E> RuleResult<T, E> success(T value) {
        return new RuleResult<>(Optional.of(Objects.requireNonNull(value, "value must not be null")), List.of());
    }

    public static <T, E> RuleResult<T, E> failure(List<E> violations) {
        if (violations == null || violations.isEmpty()) {
            throw new IllegalArgumentException("failure must contain at least one violation");
        }
        return new RuleResult<>(Optional.empty(), violations);
    }

    public boolean isSuccess() {
        return value.isPresent();
    }
}
