package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcListingRegistrationRepository;
import com.bidflow.adapters.storage.S3ObjectStorage;
import com.bidflow.adapters.storage.S3ObjectStorageSettings;
import com.bidflow.application.listing.IdentifierGenerator;
import com.bidflow.application.listing.ListingRegistrationRepository;
import com.bidflow.application.listing.ListingRegistrationService;
import com.bidflow.application.storage.ObjectStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.URI;
import java.util.UUID;

@Configuration
class ListingConfiguration {
    @Bean(destroyMethod = "close")
    ObjectStorage objectStorage(@Value("${bidflow.storage.endpoint}") String endpoint, @Value("${bidflow.storage.bucket}") String bucket,
                                @Value("${bidflow.storage.access-key}") String accessKey, @Value("${bidflow.storage.secret-key}") String secretKey,
                                @Value("${bidflow.storage.region}") String region) {
        return new S3ObjectStorage(new S3ObjectStorageSettings(URI.create(endpoint), bucket, accessKey, secretKey, region));
    }
    @Bean ListingRegistrationRepository listingRepository(JdbcTemplate jdbc, TransactionTemplate tx) { return new JdbcListingRegistrationRepository(jdbc, tx); }
    @Bean ListingRegistrationService listingService(ListingRegistrationRepository repository, ObjectStorage storage) { return new ListingRegistrationService(repository, storage); }
    @Bean IdentifierGenerator identifierGenerator() { return UUID::randomUUID; }
}
