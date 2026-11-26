package com.bidflow.adapters.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.search.ProductSearchDocument;
import com.bidflow.application.search.SearchListingsQuery;
import com.bidflow.application.search.SearchSort;
import com.bidflow.application.search.SearchUnavailableException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.http.ExecutableHttpRequest;
import software.amazon.awssdk.http.HttpExecuteRequest;
import software.amazon.awssdk.http.HttpExecuteResponse;
import software.amazon.awssdk.http.SdkHttpClient;
import software.amazon.awssdk.http.SdkHttpMethod;
import software.amazon.awssdk.http.SdkHttpResponse;

class AwsOpenSearchTransportTest {
    private static final String REGION = "ap-northeast-1";
    private static final URI ENDPOINT = URI.create("https://vpc-bidflow-verification-search-demo.ap-northeast-1.es.amazonaws.com");
    private static final Instant NOW = Instant.parse("2026-11-26T00:00:00Z");
    private static final UUID PRODUCT = new UUID(0, 1);
    private static final SearchListingsQuery QUERY = new SearchListingsQuery("카메라", Optional.empty(), Optional.empty(),
            Optional.empty(), Optional.empty(), Optional.empty(), SearchSort.RELEVANCE, 20, Optional.empty());

    @Test void signsSearchAndIndexRequestsWithTheSamePayloadThatIsSent() throws Exception {
        var client = new RecordingClient();
        try (var transport = transport(client)) {
            var reader = new OpenSearchProductSearchReader(transport, new ObjectMapper());
            var writer = new OpenSearchProductDocumentWriter(transport);
            assertThat(reader.search(QUERY).items()).isEmpty();
            writer.upsert(new ProductSearchDocument(PRODUCT, new UUID(0, 2), "seller", "중고 카메라", "DIGITAL",
                    "GOOD", null, 50_000, 55_000, "ACTIVE", true, NOW, NOW.plusSeconds(60), 1, 2, NOW));

            assertThat(client.requests).hasSize(2);
            var search = client.requests.get(0);
            var index = client.requests.get(1);
            assertThat(search.httpRequest().method()).isEqualTo(SdkHttpMethod.POST);
            assertThat(search.httpRequest().getUri()).isEqualTo(ENDPOINT.resolve("/bidflow-products-read/_search"));
            assertThat(index.httpRequest().method()).isEqualTo(SdkHttpMethod.PUT);
            assertThat(index.httpRequest().getUri()).isEqualTo(ENDPOINT.resolve("/bidflow-products-write/_doc/" + PRODUCT + "?require_alias=true"));
            assertThat(payload(search)).contains("\"title\":\"카메라\"", "\"searchable\":true");
            assertThat(payload(index)).contains("\"productId\":\"" + PRODUCT + "\"", "\"title\":\"중고 카메라\"");
            for (var request : client.requests) {
                assertThat(request.httpRequest().firstMatchingHeader("X-Amz-Date")).contains("20261126T000000Z");
                assertThat(request.httpRequest().firstMatchingHeader("X-Amz-Security-Token")).contains("fixture-session");
                assertThat(authorization(request)).contains("Credential=fixture-key/20261126/ap-northeast-1/es/aws4_request",
                        "SignedHeaders=", "Signature=");
            }

            transport.execute("POST", "/bidflow-products-read/_search", payload(search) + " ");
            assertThat(authorization(client.requests.get(2))).isNotEqualTo(authorization(search));
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {301, 403})
    void doesNotFollowRedirectsOrRetryUnsignedAndKeepsResponseBodyPrivate(int status) {
        var client = new RecordingClient();
        client.status = status;
        try (var transport = transport(client)) {
            var reader = new OpenSearchProductSearchReader(transport, new ObjectMapper());
            assertThatThrownBy(() -> reader.search(QUERY)).isInstanceOf(SearchUnavailableException.class)
                    .hasMessage("OpenSearch status " + status).hasNoCause();
        }
        assertThat(client.requests).hasSize(1);
    }

    @Test void sdkAndCredentialErrorsDoNotSurfaceSensitiveDetails() {
        var client = new RecordingClient();
        client.fail = true;
        try (var transport = transport(client)) {
            assertThatThrownBy(() -> transport.execute("POST", "/bidflow-products-read/_search", "{}"))
                    .isInstanceOf(IOException.class).hasMessage("Managed OpenSearch request failed.").hasNoCause();
        }
        try (var transport = new AwsOpenSearchTransport(ENDPOINT, REGION,
                () -> { throw new IllegalStateException("credential-marker"); }, client, Clock.fixed(NOW, ZoneOffset.UTC))) {
            assertThatThrownBy(() -> transport.execute("POST", "/bidflow-products-read/_search", "{}"))
                    .isInstanceOf(IOException.class).hasMessage("Managed OpenSearch request failed.").hasNoCause();
        }
        assertThat(client.requests).hasSize(1);
    }

    @Test void malformedSuccessfulResponseDoesNotExposeItsBody() {
        var client = new RecordingClient();
        client.body = "private-response-marker";
        try (var transport = transport(client)) {
            var reader = new OpenSearchProductSearchReader(transport, new ObjectMapper());
            assertThatThrownBy(() -> reader.search(QUERY)).isInstanceOf(SearchUnavailableException.class)
                    .hasMessage("OpenSearch search failed.").hasNoCause();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "http://localhost:9200", "https://search-public.ap-northeast-1.es.amazonaws.com",
            "https://vpc-bidflow-verification-search-demo.ap-northeast-1.es.amazonaws.com.other.example",
            "https://vpc-bidflow-verification-search-demo.ap-northeast-1.es.amazonaws.com/path",
            "https://secret-marker@vpc-bidflow-verification-search-demo.ap-northeast-1.es.amazonaws.com"})
    void rejectsUnsafeDestinationsWithoutEchoingThem(String endpoint) {
        assertThatThrownBy(() -> AwsOpenSearchTransport.create(endpoint, REGION))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Managed OpenSearch requires a private Tokyo HTTPS endpoint and Region.").hasNoCause();
    }

    @Test void rejectsRegionMismatchAndAbsoluteRequestPathBeforeSending() {
        assertThatThrownBy(() -> AwsOpenSearchTransport.create(ENDPOINT.toString(), "us-east-1"))
                .isInstanceOf(IllegalArgumentException.class);
        var client = new RecordingClient();
        try (var transport = transport(client)) {
            assertThatThrownBy(() -> transport.execute("POST", "//other.example/_search", "{}"))
                    .isInstanceOf(IOException.class).hasMessage("Invalid OpenSearch request path.");
        }
        assertThat(client.requests).isEmpty();
    }

    private static AwsOpenSearchTransport transport(RecordingClient client) {
        return new AwsOpenSearchTransport(ENDPOINT, REGION,
                () -> AwsSessionCredentials.create("fixture-key", "fixture-secret", "fixture-session"),
                client, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static String authorization(HttpExecuteRequest request) {
        return request.httpRequest().firstMatchingHeader("Authorization").orElseThrow();
    }

    private static String payload(HttpExecuteRequest request) throws IOException {
        try (var body = request.contentStreamProvider().orElseThrow().newStream()) {
            return new String(body.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static final class RecordingClient implements SdkHttpClient {
        private final List<HttpExecuteRequest> requests = new ArrayList<>();
        private int status = 200;
        private boolean fail;
        private String body = "{\"hits\":{\"hits\":[]}}";

        @Override public ExecutableHttpRequest prepareRequest(HttpExecuteRequest request) {
            requests.add(request);
            return new ExecutableHttpRequest() {
                @Override public HttpExecuteResponse call() throws IOException {
                    if (fail) throw new IOException("secret SDK request details");
                    return HttpExecuteResponse.builder()
                            .response(SdkHttpResponse.builder().statusCode(status)
                                    .putHeader("Location", "https://other.example").build())
                            .responseBody(AbortableInputStream.create(new ByteArrayInputStream(
                                    (status == 200 ? body : "private response marker").getBytes(StandardCharsets.UTF_8))))
                            .build();
                }
                @Override public void abort() {}
            };
        }
        @Override public void close() {}
    }
}
