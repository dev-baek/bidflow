package com.bidflow.event;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class EventContractValidator {
    private EventContractValidator() {
    }

    public static List<EventContractViolation> validate(
            String topic,
            String partitionKey,
            EventEnvelope<Map<String, Object>> event
    ) {
        var contract = EventContracts.find(topic, event.eventType());
        if (contract.isEmpty()) {
            return List.of(new EventContractViolation(EventContractViolationType.EVENT_CONTRACT_UNKNOWN, event.eventType()));
        }

        List<EventContractViolation> violations = new ArrayList<>();
        if (partitionKey == null || partitionKey.isBlank()) {
            violations.add(new EventContractViolation(EventContractViolationType.PARTITION_KEY_REQUIRED, contract.get().partitionKeyField()));
        }
        for (String field : contract.get().requiredPayloadFields()) {
            if (!event.payload().containsKey(field) || event.payload().get(field) == null) {
                violations.add(EventContractViolation.requiredPayloadFieldMissing(field));
            }
        }
        Object payloadKey = event.payload().get(contract.get().partitionKeyField());
        if (payloadKey != null && partitionKey != null && !partitionKey.equals(payloadKey.toString())) {
            violations.add(EventContractViolation.partitionKeyMismatch(contract.get().partitionKeyField()));
        }
        return List.copyOf(violations);
    }
}
