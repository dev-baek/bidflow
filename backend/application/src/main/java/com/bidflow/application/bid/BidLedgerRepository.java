package com.bidflow.application.bid;

import java.util.Optional;

/** Durable settlement boundary for one Lua decision candidate. */
public interface BidLedgerRepository {
    /** @return the final decision if a ledger entry was created, otherwise empty for a replay. */
    Optional<DirectBidResultCode> persist(BidSettlementCommand command);
}
