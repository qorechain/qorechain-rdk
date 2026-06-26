package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.Networks;
import io.github.qorechain.rdk.config.Networks.Endpoints;
import io.github.qorechain.rdk.config.Networks.NetworkConfig;
import java.util.Map;

/**
 * The high-level entry point. Resolves a network and composes the REST and {@code qor_} JSON-RPC
 * read clients.
 */
public final class RdkClient {
    public final NetworkConfig network;
    public final RestClient rest;
    public final QorClient qor;

    /** Options for constructing an {@link RdkClient}. */
    public static final class Options {
        /** Network preset (default "testnet"). */
        public String network;
        /** Endpoint overrides; merged onto the network preset's defaults. */
        public Endpoints endpoints;
        /** Transport for the read clients (testing or custom environments). */
        public Transport transport;
    }

    public RdkClient(Options options) {
        Options o = options == null ? new Options() : options;
        NetworkConfig net = Networks.getNetwork(o.network);
        if (o.endpoints != null) {
            if (notEmpty(o.endpoints.rest)) {
                net.endpoints.rest = o.endpoints.rest;
            }
            if (notEmpty(o.endpoints.rpc)) {
                net.endpoints.rpc = o.endpoints.rpc;
            }
            if (notEmpty(o.endpoints.grpc)) {
                net.endpoints.grpc = o.endpoints.grpc;
            }
            if (notEmpty(o.endpoints.evmRpc)) {
                net.endpoints.evmRpc = o.endpoints.evmRpc;
            }
        }
        this.network = net;
        this.rest = new RestClient(net.endpoints.rest, o.transport);
        this.qor = new QorClient(net.endpoints.evmRpc, o.transport);
    }

    private static boolean notEmpty(String s) {
        return s != null && !s.isEmpty();
    }

    /** Read the live {@code rdk} module parameters from the chain. */
    public ParamsView params() {
        return rest.getParams();
    }

    /** The result of a profile suggestion. */
    public static final class ProfileSuggestion {
        public final ProfileName profile;
        /** {@code "advisory"} when from the service, {@code "fallback"} otherwise. */
        public final String source;
        /** The raw advisory response (or error message), for transparency. */
        public final Object raw;

        ProfileSuggestion(ProfileName profile, String source, Object raw) {
            this.profile = profile;
            this.source = source;
            this.raw = raw;
        }
    }

    private static ProfileName extractProfile(Object result) {
        if (result instanceof String) {
            ProfileName p = ProfileName.fromWire((String) result);
            if (p != null) {
                return p;
            }
        }
        if (result instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) result;
            for (String k :
                    new String[] {"profile", "suggestedProfile", "suggested_profile", "recommendation"}) {
                Object v = m.get(k);
                if (v instanceof String) {
                    ProfileName p = ProfileName.fromWire((String) v);
                    if (p != null) {
                        return p;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Suggest a rollup profile from a plain-language use-case description, falling back to a
     * documented default ({@code defi}) when the advisory is unavailable.
     */
    public ProfileSuggestion suggestProfile(String useCase, ProfileName fallback) {
        ProfileName fb = fallback == null ? ProfileName.DEFI : fallback;
        try {
            Object result = qor.suggestRollupProfile(useCase);
            ProfileName profile = extractProfile(result);
            if (profile != null) {
                return new ProfileSuggestion(profile, "advisory", result);
            }
            return new ProfileSuggestion(fb, "fallback", result);
        } catch (RuntimeException e) {
            return new ProfileSuggestion(fb, "fallback", e.getMessage());
        }
    }
}
