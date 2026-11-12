package com.bidflow.application.bid;

/** Durable settlement boundary for one Lua decision. */
public interface BidLedgerRepository {
    /** @return {@code true} only when this call created the durable ledger entry. */
    boolean persist(BidSettlementCommand command);
}
