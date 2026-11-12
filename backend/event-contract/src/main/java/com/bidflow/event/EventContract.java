package com.bidflow.event;

import java.util.List;

public record EventContract(
        String topic,
        String eventType,
        String partitionKeyField,
        List<String> requiredPayloadFields
) {
    public EventContract {
        requiredPayloadFields = List.copyOf(requiredPayloadFields);
    }
}
