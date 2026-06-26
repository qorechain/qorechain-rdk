package io.github.qorechain.rdk.client;

import java.util.Map;

/**
 * The minimal HTTP capability the read/broadcast clients depend on. The production implementation
 * ({@link HttpTransport}) is backed by {@link java.net.http.HttpClient}; tests inject a mock so they
 * never touch the network.
 */
@FunctionalInterface
public interface Transport {
    /** Perform an HTTP exchange and return the response. */
    Response exchange(Request request);

    /** An HTTP request. {@code body} is {@code null} for GET. */
    final class Request {
        public final String method;
        public final String url;
        public final Map<String, String> headers;
        public final String body;

        public Request(String method, String url, Map<String, String> headers, String body) {
            this.method = method;
            this.url = url;
            this.headers = headers;
            this.body = body;
        }
    }

    /** An HTTP response. */
    final class Response {
        public final int statusCode;
        public final String body;

        public Response(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }
    }
}
