package com.bidflow.application.bid;

/** Executes a direct bid against the active-auction projection as one atomic operation. */
public interface DirectBidProcessor {
    DirectBidResult execute(DirectBidCommand command);
}
