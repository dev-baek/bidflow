package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcListingRegistrationRepository;
import com.bidflow.adapters.storage.S3ObjectStorage;
import com.bidflow.adapters.storage.S3ObjectStorageSettings;
import com.bidflow.application.listing.IdentifierGenerator;
import com.bidflow.application.listing.ListingRegistrationRepository;
import com.bidflow.application.listing.ListingRegistrationService;
import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.PresignedUpload;
import com.bidflow.application.storage.StoredObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.util.Optional;
import java.util.UUID;

@Configuration
class ListingConfiguration {
    @Bean(destroyMethod = "close")
    @Profile("!verification")
    ObjectStorage objectStorage(@Value("${bidflow.storage.endpoint}") String endpoint, @Value("${bidflow.storage.bucket}") String bucket,
                                @Value("${bidflow.storage.access-key}") String accessKey, @Value("${bidflow.storage.secret-key}") String secretKey,
                                @Value("${bidflow.storage.region}") String region) {
        return new S3ObjectStorage(new S3ObjectStorageSettings(URI.create(endpoint), bucket, accessKey, secretKey, region));
    }

    @Bean
    @Profile("verification")
    ObjectStorage verificationObjectStorage(@Value("${bidflow.storage.verification-bucket:}") String bucket,
            @Value("${bidflow.storage.verification-region:}") String region) {
        if (!bucket.isBlank()) return S3ObjectStorage.forAws(bucket, region);
        return new ObjectStorage() {
            @Override
            public PresignedUpload presignUpload(PresignUploadCommand command) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            }

            @Override
            public Optional<StoredObject> headObject(String objectKey) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            }

            @Override
            public URI presignRead(String objectKey) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            }
        };
    }

    @Bean ListingRegistrationRepository listingRepository(JdbcTemplate jdbc, TransactionTemplate tx) { return new JdbcListingRegistrationRepository(jdbc, tx); }
    @Bean ListingRegistrationService listingService(ListingRegistrationRepository repository, ObjectStorage storage) { return new ListingRegistrationService(repository, storage); }
    @Bean IdentifierGenerator identifierGenerator() { return UUID::randomUUID; }
}
