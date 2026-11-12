package com.bidflow.application.bid;

/** Atomically resolves an automatic maximum against the current active-auction leader. */
public interface AutoBidProcessor {
    DirectBidResult execute(AutoBidCommand command);
}
