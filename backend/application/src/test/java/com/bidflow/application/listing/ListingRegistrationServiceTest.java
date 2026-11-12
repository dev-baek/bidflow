package com.bidflow.application.listing;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.PresignedUpload;
import com.bidflow.application.storage.StoredObject;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ListingRegistrationServiceTest {
    private static final Instant NOW = Instant.parse("2026-11-12T00:00:00Z");
    private static final String SELLER_ID = "seller-1";
    private static final UUID UPLOAD_ID = UUID.fromString("00000000-0000-0000-0000-000000000010");

    @Test
    void savesProductAuctionImagesIdempotencyRecordAndOutboxInOneRegistration() {
        InMemoryRepository repository = new InMemoryRepository();
        ListingRegistrationService service = new ListingRegistrationService(repository, new ExistingUploadStorage(SELLER_ID, UPLOAD_ID));
        ListingRegistrationResult result = service.register(command("request-1"), SELLER_ID, NOW, ids());

        assertThat(result.auctionStatus()).isEqualTo("SCHEDULED");
        assertThat(repository.saved).hasSize(1);
        assertThat(repository.saved.getFirst().images()).hasSize(1);
        assertThat(repository.saved.getFirst().outbox().eventType()).isEqualTo("ListingPublished");
        assertThat(repository.saved.getFirst().outbox().payload())
                .contains("\"sellerId\":\"seller-1\"")
                .contains("\"title\":\"중고 카메라\"")
                .contains("\"categoryId\":\"DIGITAL\"")
                .contains("\"publishedAt\":\"2026-11-12T00:00:00Z\"")
                .contains("\"listingVersion\":1");
    }

    @Test
    void returnsOriginalResultForSameActorKeyAndPayload() {
        InMemoryRepository repository = new InMemoryRepository();
        ListingRegistrationService service = new ListingRegistrationService(repository, new ExistingUploadStorage(SELLER_ID, UPLOAD_ID));
        ListingRegistrationResult first = service.register(command("request-1"), SELLER_ID, NOW, ids());
        ListingRegistrationResult retried = service.register(command("request-1"), SELLER_ID, NOW, ids());

        assertThat(retried).isEqualTo(first);
        assertThat(repository.saved).hasSize(1);
    }

    @Test
    void rejectsSameActorKeyWithDifferentPayload() {
        InMemoryRepository repository = new InMemoryRepository();
        ListingRegistrationService service = new ListingRegistrationService(repository, new ExistingUploadStorage(SELLER_ID, UPLOAD_ID));
        service.register(command("request-1"), SELLER_ID, NOW, ids());

        assertThatThrownBy(() -> service.register(command("request-1", "다른 상품 제목"), SELLER_ID, NOW, ids()))
                .isInstanceOf(IdempotencyConflictException.class);
    }

    @Test
    void rejectsUploadNotOwnedByActor() {
        ListingRegistrationService service = new ListingRegistrationService(new InMemoryRepository(), new ExistingUploadStorage("other-seller", UPLOAD_ID));

        assertThatThrownBy(() -> service.register(command("request-1"), SELLER_ID, NOW, ids()))
                .isInstanceOf(UploadNotReadyException.class);
    }

    private static ListingRegistrationCommand command(String idempotencyKey) {
        return command(idempotencyKey, "중고 카메라");
    }

    private static ListingRegistrationCommand command(String idempotencyKey, String title) {
        return new ListingRegistrationCommand(
                idempotencyKey,
                title,
                "정상 동작하는 미러리스 카메라입니다.",
                "DIGITAL",
                "GOOD",
                50_000L,
                NOW.plusSeconds(600),
                NOW.plusSeconds(3_600),
                List.of(UPLOAD_ID)
        );
    }

    private static DeterministicIds ids() {
        return new DeterministicIds();
    }

    private static final class DeterministicIds implements IdentifierGenerator {
        private int next = 1;

        @Override
        public UUID nextUuid() {
            return new UUID(0L, next++);
        }
    }

    private static final class ExistingUploadStorage implements ObjectStorage {
        private final String owner;
        private final UUID uploadId;

        private ExistingUploadStorage(String owner, UUID uploadId) {
            this.owner = owner;
            this.uploadId = uploadId;
        }

        @Override
        public PresignedUpload presignUpload(PresignUploadCommand command) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<StoredObject> headObject(String objectKey) {
            String expected = "products/" + owner + "/" + uploadId;
            return expected.equals(objectKey)
                    ? Optional.of(new StoredObject(objectKey, "image/jpeg", 5L))
                    : Optional.empty();
        }
    }

    private static final class InMemoryRepository implements ListingRegistrationRepository {
        private final List<NewListingRegistration> saved = new ArrayList<>();

        @Override
        public Optional<IdempotencyRecord> findIdempotency(String sellerId, String idempotencyKey) {
            return saved.stream()
                    .filter(value -> value.sellerId().equals(sellerId) && value.idempotencyKey().equals(idempotencyKey))
                    .findFirst()
                    .map(value -> new IdempotencyRecord(value.payloadHash(), value.result()));
        }

        @Override
        public void save(NewListingRegistration registration) {
            saved.add(registration);
        }
    }
}
