package com.bidflow.application.bid;
import static org.assertj.core.api.Assertions.assertThat;
import java.util.UUID;
import org.junit.jupiter.api.Test;
class BidCommandMessageTest {
 @Test void usesAuctionIdAsKafkaKey() {
  UUID auctionId=UUID.randomUUID();
  BidCommandMessage message=BidCommandMessage.from(UUID.randomUUID(),auctionId,"bidder-1",BidKind.DIRECT,5000L);
  assertThat(message.kafkaKey()).isEqualTo(auctionId.toString());
  assertThat(message.eventType()).isEqualTo("BidCommandRequested");
 }
}
