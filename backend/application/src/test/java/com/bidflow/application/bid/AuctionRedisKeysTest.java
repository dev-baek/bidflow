package com.bidflow.application.bid;
import static org.assertj.core.api.Assertions.assertThat;
import java.util.UUID;
import org.junit.jupiter.api.Test;
class AuctionRedisKeysTest {
 @Test void createsNamespacedKeysForOneAuction() {
  UUID id=UUID.fromString("00000000-0000-0000-0000-000000000001");
  assertThat(AuctionRedisKeys.state(id)).isEqualTo("auction:"+id+":state");
  assertThat(AuctionRedisKeys.auto(id)).isEqualTo("auction:"+id+":auto");
  assertThat(AuctionRedisKeys.processed(id)).isEqualTo("auction:"+id+":processed");
 }
}
