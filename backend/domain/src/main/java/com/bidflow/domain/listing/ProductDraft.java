package com.bidflow.domain.listing;

import java.util.List;

public record ProductDraft(
        String title,
        String description,
        String categoryId,
        ConditionGrade conditionGrade,
        List<String> imageObjectKeys
) {
    public ProductDraft {
        imageObjectKeys = imageObjectKeys == null ? List.of() : List.copyOf(imageObjectKeys);
    }
}
