package com.bidflow.event;

public record EventContractViolation(EventContractViolationType type, String field) {
    public static EventContractViolation requiredPayloadFieldMissing(String field) {
        return new EventContractViolation(EventContractViolationType.REQUIRED_PAYLOAD_FIELD_MISSING, field);
    }

    public static EventContractViolation partitionKeyMismatch(String field) {
        return new EventContractViolation(EventContractViolationType.PARTITION_KEY_MISMATCH, field);
    }
}
