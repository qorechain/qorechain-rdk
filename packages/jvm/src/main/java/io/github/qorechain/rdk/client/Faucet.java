package io.github.qorechain.rdk.client;

import java.util.LinkedHashMap;
import java.util.Map;

/** Testnet faucet requests. */
public final class Faucet {
    private Faucet() {}

    /** Options for a faucet request. */
    public static final class FaucetOptions {
        /** The faucet endpoint URL. Required. */
        public String url;
        /** The address to fund. */
        public String address;
        /** The denomination to request. Empty defaults to uqor. */
        public String denom;
        /** Transport (for testing). Null uses a real HTTP transport. */
        public Transport transport;
    }

    /** The outcome of a faucet request. */
    public static final class FaucetResult {
        public final boolean ok;
        public final int status;
        public final Object body;

        FaucetResult(boolean ok, int status, Object body) {
            this.ok = ok;
            this.status = status;
            this.body = body;
        }
    }

    /**
     * Request testnet funds from a configured faucet URL. The network does not publish a fixed
     * faucet endpoint, so a URL must be supplied. Throws clearly when no URL is configured rather
     * than guessing one.
     */
    public static FaucetResult requestFaucet(FaucetOptions options) {
        if (options.url == null || options.url.isEmpty()) {
            throw new IllegalArgumentException(
                    "No faucet URL configured. Set a faucet endpoint (e.g. QORE_FAUCET_URL) or fund the "
                            + "account manually — see the keys & funding guide.");
        }
        String denom = (options.denom == null || options.denom.isEmpty()) ? "uqor" : options.denom;
        Transport transport = options.transport == null ? new HttpTransport() : options.transport;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("address", options.address);
        payload.put("denom", denom);

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "application/json");

        Transport.Response res =
                transport.exchange(
                        new Transport.Request("POST", options.url, headers, Json.stringify(payload)));
        Object body = res.body == null || res.body.isBlank() ? null : Json.GSON.fromJson(res.body, Object.class);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new RuntimeException("Faucet request failed: " + res.statusCode);
        }
        return new FaucetResult(true, res.statusCode, body);
    }
}
