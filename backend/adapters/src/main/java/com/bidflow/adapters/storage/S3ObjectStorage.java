package com.bidflow.adapters.storage;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.PresignedUpload;
import com.bidflow.application.storage.ProductImagePolicy;
import com.bidflow.application.storage.StoredObject;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.InstanceProfileCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;
import software.amazon.awssdk.utils.SdkAutoCloseable;

import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public final class S3ObjectStorage implements ObjectStorage, AutoCloseable {
    private static final Duration URL_EXPIRATION = Duration.ofMinutes(15);
    private static final Duration READ_URL_EXPIRATION = Duration.ofMinutes(5);

    private final String bucket;
    private final boolean conditionalWrite;
    private final S3Client s3Client;
    private final S3Presigner presigner;
    private final AwsCredentialsProvider credentials;

    public S3ObjectStorage(S3ObjectStorageSettings settings) {
        this(settings.bucket(), settings.region(),
                StaticCredentialsProvider.create(AwsBasicCredentials.create(settings.accessKey(), settings.secretKey())), settings.endpoint());
    }

    public static S3ObjectStorage forAws(String bucket, String region) {
        return forAws(bucket, region, InstanceProfileCredentialsProvider.create());
    }

    static S3ObjectStorage forAws(String bucket, String region, AwsCredentialsProvider credentials) {
        if (!bucket.matches("bidflow-verification-[0-9]{12}-images") || !"ap-northeast-1".equals(region)) {
            throw new IllegalArgumentException("Verification image storage requires the dedicated bucket and Tokyo region");
        }
        return new S3ObjectStorage(bucket, region, credentials, null);
    }

    private S3ObjectStorage(String bucket, String region, AwsCredentialsProvider credentials, URI endpoint) {
        this.bucket = bucket;
        this.credentials = credentials;
        this.conditionalWrite = endpoint == null;
        var client = S3Client.builder().httpClientBuilder(UrlConnectionHttpClient.builder())
                .credentialsProvider(credentials).region(Region.of(region));
        var signer = S3Presigner.builder().credentialsProvider(credentials).region(Region.of(region));
        if (endpoint != null) {
            var localConfiguration = S3Configuration.builder().pathStyleAccessEnabled(true).build();
            client.endpointOverride(endpoint).serviceConfiguration(localConfiguration);
            signer.endpointOverride(endpoint).serviceConfiguration(S3Configuration.builder()
                    .pathStyleAccessEnabled(true).checksumValidationEnabled(false).build());
        } else {
            // Keep the standard regional endpoint independent of inherited SDK endpoint overrides.
            var regionalEndpoint = URI.create("https://s3." + region + ".amazonaws.com");
            client.endpointOverride(regionalEndpoint);
            signer.endpointOverride(regionalEndpoint);
        }
        this.s3Client = client.build();
        this.presigner = signer.build();
    }

    @Override
    public PresignedUpload presignUpload(PresignUploadCommand command) {
        validatePolicy(command);
        String objectKey = objectKey(command);
        var putObjectRequest = PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType(command.contentType());
        if (conditionalWrite) putObjectRequest.ifNoneMatch("*");
        var request = presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(URL_EXPIRATION)
                .putObjectRequest(putObjectRequest.build())
                .build());

        if (conditionalWrite && !request.signedHeaders().keySet().equals(Set.of("content-type", "host", "if-none-match"))) {
            throw new IllegalStateException("Unexpected headers in verification upload signature");
        }
        return new PresignedUpload(
                objectKey,
                URI.create(request.url().toString()),
                conditionalWrite ? Map.of("Content-Type", command.contentType(), "If-None-Match", "*")
                        : Map.of("Content-Type", command.contentType()),
                command.now().plus(URL_EXPIRATION)
        );
    }

    @Override
    public URI presignRead(String objectKey) {
        var request = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(READ_URL_EXPIRATION)
                .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(objectKey)
                        .responseCacheControl("private, no-store").build())
                .build());
        if (!request.isBrowserExecutable()) throw new IllegalStateException("Image read URL requires browser-incompatible headers");
        return URI.create(request.url().toString());
    }

    @Override
    public Optional<StoredObject> headObject(String objectKey) {
        try {
            var response = s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(bucket)
                    .key(objectKey)
                    .build());
            if (response.contentType() == null || response.contentLength() == null) return Optional.empty();
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
        if (credentials instanceof SdkAutoCloseable closeable) closeable.close();
    }

    private static void validatePolicy(PresignUploadCommand command) {
        if (!command.actorId().matches("[A-Za-z0-9_-]{1,128}")) {
            throw new UploadPolicyViolation("actorId must be a safe object key segment");
        }
        if (!ProductImagePolicy.allowsContentType(command.contentType())) {
            throw new UploadPolicyViolation("contentType is not allowed");
        }
        if (!ProductImagePolicy.allowsLength(command.contentLength())) {
            throw new UploadPolicyViolation("contentLength must be between 1 byte and 10 MiB");
        }
    }

    private static String objectKey(PresignUploadCommand command) {
        return "products/" + command.actorId() + "/" + command.uploadId();
    }
}
