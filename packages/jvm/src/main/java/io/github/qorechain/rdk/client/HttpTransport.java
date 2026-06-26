package io.github.qorechain.rdk.client;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/** A {@link Transport} backed by {@link java.net.http.HttpClient}. */
public final class HttpTransport implements Transport {
    private final HttpClient client;

    public HttpTransport() {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build());
    }

    public HttpTransport(HttpClient client) {
        this.client = client;
    }

    @Override
    public Response exchange(Request request) {
        HttpRequest.Builder builder = HttpRequest.newBuilder().uri(URI.create(request.url));
        if (request.headers != null) {
            for (Map.Entry<String, String> e : request.headers.entrySet()) {
                builder.header(e.getKey(), e.getValue());
            }
        }
        if ("GET".equalsIgnoreCase(request.method)) {
            builder.GET();
        } else {
            String body = request.body == null ? "" : request.body;
            builder.method(request.method, HttpRequest.BodyPublishers.ofString(body));
        }
        try {
            HttpResponse<String> response =
                    client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body());
        } catch (IOException e) {
            throw new RuntimeException("HTTP request failed: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("HTTP request interrupted", e);
        }
    }
}
