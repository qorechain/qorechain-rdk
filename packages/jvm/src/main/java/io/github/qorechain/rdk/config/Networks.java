package io.github.qorechain.rdk.config;

import java.util.List;

/**
 * Named network presets. The RDK defaults to testnet. Endpoint defaults point at localhost —
 * override them to reach a real node.
 */
public final class Networks {
    private Networks() {}

    /** Endpoint URLs the RDK talks to. */
    public static class Endpoints {
        /** Cosmos REST (LCD) — rollup/batch/DA/params reads. */
        public String rest;
        /** Consensus RPC — transaction broadcast. */
        public String rpc;
        /** gRPC (host:port) — typed queries (parity with REST). */
        public String grpc;
        /** EVM + {@code qor_} JSON-RPC — the custom {@code qor_*} rollup methods. */
        public String evmRpc;

        public Endpoints() {}

        public Endpoints(String rest, String rpc, String grpc, String evmRpc) {
            this.rest = rest;
            this.rpc = rpc;
            this.grpc = grpc;
            this.evmRpc = evmRpc;
        }

        public Endpoints copy() {
            return new Endpoints(rest, rpc, grpc, evmRpc);
        }
    }

    /** A resolved network: its chain id and endpoints. */
    public static class NetworkConfig {
        public String name;
        public String chainId;
        public Endpoints endpoints;

        public NetworkConfig() {}

        public NetworkConfig(String name, String chainId, Endpoints endpoints) {
            this.name = name;
            this.chainId = chainId;
            this.endpoints = endpoints;
        }

        public NetworkConfig copy() {
            return new NetworkConfig(name, chainId, endpoints == null ? null : endpoints.copy());
        }
    }

    private static Endpoints localhostEndpoints() {
        return new Endpoints(
                "http://localhost:1317",
                "http://localhost:26657",
                "localhost:9090",
                "http://localhost:8545");
    }

    /** Look up a network preset by name. An empty/unknown name defaults to testnet. */
    public static NetworkConfig getNetwork(String name) {
        String n = (name == null || name.isEmpty()) ? "testnet" : name;
        String chainId = Constants.CHAIN_IDS.get(n);
        if (chainId == null) {
            n = "testnet";
            chainId = Constants.TESTNET_CHAIN_ID;
        }
        return new NetworkConfig(n, chainId, localhostEndpoints());
    }

    /** List the available network names. */
    public static List<String> listNetworks() {
        return List.of("testnet", "mainnet");
    }
}
