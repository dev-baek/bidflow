package com.bidflow.adapters.persistence;
import com.bidflow.application.bid.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
public final class JdbcBidRequestRepository implements BidRequestRepository {
 private final JdbcTemplate jdbc; public JdbcBidRequestRepository(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public Optional<UUID> find(String bidder,String key,String hash){return jdbc.query("select bid_request_id from bid_request where bidder_id=? and idempotency_key=? and payload_hash=?",rs->rs.next()?Optional.of(rs.getObject(1,UUID.class)):Optional.empty(),bidder,key,hash);}
 public void save(String bidder,String key,String hash,UUID id,BidRequestCommand c){jdbc.update("insert into bid_request (bid_request_id,auction_id,bidder_id,bid_kind,amount,status,requested_at,correlation_id,idempotency_key,payload_hash) values (?,?,?,?,?,'RECEIVED',?,?,?,?,?)",id,c.auctionId(),bidder,c.bidKind(),c.amount(),java.sql.Timestamp.from(Instant.now()),key,key,hash);}
}
