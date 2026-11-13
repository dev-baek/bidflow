package com.bidflow.application.bid;

/** PostgreSQL source of truth for private automatic-bid maxima. */
public interface AutoBidMaximumRepository {
    void save(AutoBidMaximum maximum);
}
