package com.bidflow.runtime;
import com.bidflow.adapters.persistence.JdbcBidRequestRepository;
import com.bidflow.application.bid.*;
import java.util.UUID;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
@Configuration class BidRequestConfiguration {
 @Bean BidRequestRepository bidRequestRepository(JdbcTemplate jdbc, org.springframework.transaction.support.TransactionTemplate tx){return new JdbcBidRequestRepository(jdbc,tx);}
 @Bean BidRequestIdempotencyService bidRequestIdempotencyService(BidRequestRepository repository){return new BidRequestIdempotencyService(repository, UUID::randomUUID);}
}
