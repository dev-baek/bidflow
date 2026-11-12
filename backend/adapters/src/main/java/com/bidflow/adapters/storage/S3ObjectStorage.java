package com.bidflow.adapters.storage;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.PresignedUpload;
import com.bidflow.application.storage.StoredObject;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public final class S3ObjectStorage implements ObjectStorage, AutoCloseable {
    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of("image/jpeg", "image/png", "image/webp");
    private static final long MAX_CONTENT_LENGTH = 10L * 1024L * 1024L;
    private static final Duration URL_EXPIRATION = Duration.ofMinutes(15);

    private final S3ObjectStorageSettings settings;
    private final S3Client s3Client;
    private final S3Presigner presigner;

    public S3ObjectStorage(S3ObjectStorageSettings settings) {
        this.settings = settings;
        var credentials = StaticCredentialsProvider.create(AwsBasicCredentials.create(settings.accessKey(), settings.secretKey()));
        var serviceConfiguration = S3Configuration.builder().pathStyleAccessEnabled(true).build();

        this.s3Client = S3Client.builder()
                .httpClient(UrlConnectionHttpClient.builder().build())
                .credentialsProvider(credentials)
                .region(Region.of(settings.region()))
                .endpointOverride(settings.endpoint())
                .serviceConfiguration(serviceConfiguration)
                .build();
        this.presigner = S3Presigner.builder()
                .credentialsProvider(credentials)
                .region(Region.of(settings.region()))
                .endpointOverride(settings.endpoint())
                .serviceConfiguration(serviceConfiguration)
                .build();
    }

    @Override
    public PresignedUpload presignUpload(PresignUploadCommand command) {
        validatePolicy(command);
        String objectKey = objectKey(command);
        PutObjectRequest putObjectRequest = PutObjectRequest.builder()
                .bucket(settings.bucket())
                .key(objectKey)
                .contentType(command.contentType())
                .build();
        var request = presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(URL_EXPIRATION)
                .putObjectRequest(putObjectRequest)
                .build());

        return new PresignedUpload(
                objectKey,
                java.net.URI.create(request.url().toString()),
                Map.of("Content-Type", command.contentType()),
                command.now().plus(URL_EXPIRATION)
        );
    }

    @Override
    public Optional<StoredObject> headObject(String objectKey) {
        try {
            var response = s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(settings.bucket())
                    .key(objectKey)
                    .build());
            return Optional.of(new StoredObject(objectKey, response.contentType(), response.contentLength()));
        } catch (NoSuchKeyException exception) {
            return Optional.empty();
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404) {
                return Optional.empty();
            }
            throw exception;
        }
    }

    @Override
    public void close() {
        presigner.close();
        s3Client.close();
    }

    private static void validatePolicy(PresignUploadCommand command) {
        if (!command.actorId().matches("[A-Za-z0-9_-]{1,128}")) {
            throw new UploadPolicyViolation("actorId must be a safe object key segment");
        }
        if (!ALLOWED_CONTENT_TYPES.contains(command.contentType())) {
            throw new UploadPolicyViolation("contentType is not allowed");
        }
        if (command.contentLength() <= 0 || command.contentLength() > MAX_CONTENT_LENGTH) {
            throw new UploadPolicyViolation("contentLength must be between 1 byte and 10 MiB");
        }
    }

    private static String objectKey(PresignUploadCommand command) {
        return "products/" + command.actorId() + "/" + command.uploadId();
    }
}
