package com.bidflow.event;

public enum EventContractViolationType {
    EVENT_CONTRACT_UNKNOWN,
    PARTITION_KEY_REQUIRED,
    PARTITION_KEY_MISMATCH,
    REQUIRED_PAYLOAD_FIELD_MISSING
}
