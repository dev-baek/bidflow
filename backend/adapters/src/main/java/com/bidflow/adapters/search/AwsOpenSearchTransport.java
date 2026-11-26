package com.bidflow.adapters.search;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.InstanceProfileCredentialsProvider;
import software.amazon.awssdk.http.ContentStreamProvider;
import software.amazon.awssdk.http.HttpExecuteRequest;
import software.amazon.awssdk.http.SdkHttpClient;
import software.amazon.awssdk.http.SdkHttpMethod;
import software.amazon.awssdk.http.SdkHttpRequest;
import software.amazon.awssdk.http.auth.aws.signer.AwsV4HttpSigner;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;

public final class AwsOpenSearchTransport implements OpenSearchTransport, AutoCloseable {
    private final URI endpoint;
    private final String region;
    private final AwsCredentialsProvider credentials;
    private final SdkHttpClient client;
    private final Clock clock;
    private final AwsV4HttpSigner signer = AwsV4HttpSigner.create();

    public static OpenSearchTransport create(String endpoint, String region) {
        var uri = managedEndpoint(endpoint, region);
        var client = UrlConnectionHttpClient.builder()
                .connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(5)).build();
        return new AwsOpenSearchTransport(uri, region, InstanceProfileCredentialsProvider.create(), client, Clock.systemUTC());
    }

    AwsOpenSearchTransport(URI endpoint, String region, AwsCredentialsProvider credentials, SdkHttpClient client, Clock clock) {
        this.endpoint = endpoint;
        this.region = region;
        this.credentials = credentials;
        this.client = client;
        this.clock = clock;
    }

    private static URI managedEndpoint(String value, String region) {
        URI uri;
        try { uri = value == null ? null : URI.create(value); }
        catch (IllegalArgumentException exception) { uri = null; }
        if (uri == null || !"ap-northeast-1".equals(region) || !"https".equals(uri.getScheme())
                || uri.getHost() == null || !uri.getHost().matches("vpc-bidflow-verification-search-[a-z0-9-]+\\.ap-northeast-1\\.es\\.amazonaws\\.com")
                || uri.getPort() != -1 || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))) {
            throw new IllegalArgumentException("Managed OpenSearch requires a private Tokyo HTTPS endpoint and Region.");
        }
        return uri;
    }

    @Override public Response execute(String method, String path, String json) throws IOException {
        if (!path.startsWith("/") || path.startsWith("//")) throw new IOException("Invalid OpenSearch request path.");
        try {
            var request = SdkHttpRequest.builder().uri(endpoint.resolve(path)).method(SdkHttpMethod.fromValue(method))
                    .putHeader("Content-Type", "application/json");
            if ("PUT".equals(method)) request.putRawQueryParameter("require_alias", "true");
            var signed = signer.sign(input -> input.identity(credentials.resolveCredentials()).request(request.build())
                    .payload(ContentStreamProvider.fromUtf8String(json))
                    .putProperty(AwsV4HttpSigner.SERVICE_SIGNING_NAME, "es")
                    .putProperty(AwsV4HttpSigner.REGION_NAME, region)
                    .putProperty(AwsV4HttpSigner.SIGNING_CLOCK, clock));
            var response = client.prepareRequest(HttpExecuteRequest.builder().request(signed.request())
                    .contentStreamProvider(signed.payload().orElseThrow()).build()).call();
            try (var body = response.responseBody().orElse(null)) {
                String result = body != null && "POST".equals(method) && response.httpResponse().isSuccessful()
                        ? new String(body.readAllBytes(), StandardCharsets.UTF_8) : "";
                return new Response(response.httpResponse().statusCode(), result);
            }
        } catch (IOException | RuntimeException exception) {
            // SDK errors can contain request or credential details; only surface a fixed failure.
            throw new IOException("Managed OpenSearch request failed.");
        }
    }

    @Override public void close() {
        try (client) {
            if (credentials instanceof InstanceProfileCredentialsProvider provider) provider.close();
        }
    }
}
