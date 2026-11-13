package com.bidflow.runtime;

/** Pure failure classification used to make DLT records searchable without parsing stack traces. */
enum KafkaFailureCategory {
    CONTRACT_INVALID,
    TRANSIENT_EXHAUSTED;

    static KafkaFailureCategory from(Exception exception) {
        return exception instanceof IllegalArgumentException ? CONTRACT_INVALID : TRANSIENT_EXHAUSTED;
    }
}
