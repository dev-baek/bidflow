package com.bidflow.adapters.persistence;
import com.bidflow.application.bid.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
public final class JdbcBidRequestRepository implements BidRequestRepository {
 private final JdbcTemplate jdbc; private final TransactionTemplate tx; public JdbcBidRequestRepository(JdbcTemplate jdbc,TransactionTemplate tx){this.jdbc=jdbc;this.tx=tx;}
 public Optional<UUID> find(String bidder,String key,String hash){return jdbc.query("select bid_request_id from bid_request where bidder_id=? and idempotency_key=? and payload_hash=?",rs->rs.next()?Optional.of(rs.getObject(1,UUID.class)):Optional.empty(),bidder,key,hash);}
 public void save(String bidder,String key,String hash,String correlationId,UUID id,BidRequestCommand c){tx.executeWithoutResult(s->{jdbc.update("insert into bid_request (bid_request_id,auction_id,bidder_id,bid_kind,amount,status,requested_at,correlation_id,idempotency_key,payload_hash) values (?,?,?,?,?,'RECEIVED',?,?,?,?,?)",id,c.auctionId(),bidder,c.bidKind(),c.amount(),java.sql.Timestamp.from(Instant.now()),correlationId,key,hash);jdbc.update("insert into outbox_event (event_id,aggregate_type,aggregate_id,topic,partition_key,correlation_id,event_type,schema_version,payload,occurred_at) values (?,'Auction',?,'bid-command',? ,?,'BidCommandRequested',1,cast(? as jsonb),?)",UUID.randomUUID(),c.auctionId(),c.auctionId().toString(),correlationId,"{\"bidRequestId\":\""+id+"\",\"auctionId\":\""+c.auctionId()+"\",\"bidderId\":\""+bidder+"\",\"bidKind\":\""+c.bidKind()+"\",\"amount\":"+c.amount()+",\"requestedAt\":\""+Instant.now()+"\"}",java.sql.Timestamp.from(Instant.now()));});}
}
