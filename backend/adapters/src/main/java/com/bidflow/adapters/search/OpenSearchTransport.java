package com.bidflow.adapters.search;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

@FunctionalInterface
public interface OpenSearchTransport {
    Response execute(String method, String path, String json) throws IOException, InterruptedException;

    record Response(int status, String body) {
        boolean successful() { return status >= 200 && status < 300; }
    }

    static OpenSearchTransport local(HttpClient client, URI endpoint) {
        return (method, path, json) -> {
            var request = HttpRequest.newBuilder(endpoint.resolve(path))
                    .header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(json)).build();
            var response = client.send(request, "PUT".equals(method)
                    ? HttpResponse.BodyHandlers.replacing("") : HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body());
        };
    }
}
