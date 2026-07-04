/**
 * Named network presets. The RDK defaults to testnet. Endpoint defaults point at
 * localhost — override them to reach a real node.
 */
import { CHAIN_IDS, type NetworkName } from "../constants";

/** Endpoint URLs the RDK talks to. */
export interface Endpoints {
  /** Cosmos REST (LCD) — rollup/batch/DA/params reads. */
  rest: string;
  /** Consensus RPC — transaction broadcast. */
  rpc: string;
  /** gRPC (host:port) — typed queries (parity with REST). */
  grpc: string;
  /** EVM + `qor_` JSON-RPC — the custom `qor_*` rollup methods. */
  evmRpc: string;
}

/** A resolved network: its chain id and endpoints. */
export interface NetworkConfig {
  name: NetworkName;
  chainId: string;
  endpoints: Endpoints;
}

/** Localhost defaults, for running against a local node. */
export const LOCALHOST_ENDPOINTS: Endpoints = {
  rest: "http://localhost:1317",
  rpc: "http://localhost:26657",
  grpc: "localhost:9090",
  evmRpc: "http://localhost:8545",
};

/** Public mainnet endpoints (`qorechain-vladi`). */
const MAINNET_ENDPOINTS: Endpoints = {
  rest: "https://api.qore.host",
  rpc: "https://rpc.qore.host",
  grpc: "grpc.qore.host:443",
  evmRpc: "https://evm.qore.host",
};

/** Public testnet endpoints (`qorechain-diana`). */
const TESTNET_ENDPOINTS: Endpoints = {
  rest: "https://api-testnet.qore.host",
  rpc: "https://rpc-testnet.qore.host",
  grpc: "grpc-testnet.qore.host:443",
  evmRpc: "https://evm-testnet.qore.host",
};

/**
 * Built-in network presets. Each ships the network's public endpoints so
 * `createRdkClient({ network })` works out of the box; override `endpoints` to
 * point at a local node ({@link LOCALHOST_ENDPOINTS}) or your own infrastructure.
 */
export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    chainId: CHAIN_IDS.testnet,
    endpoints: { ...TESTNET_ENDPOINTS },
  },
  mainnet: {
    name: "mainnet",
    chainId: CHAIN_IDS.mainnet,
    endpoints: { ...MAINNET_ENDPOINTS },
  },
};

/** Look up a network preset by name. Defaults to testnet. */
export function getNetwork(name: NetworkName = "testnet"): NetworkConfig {
  const net = NETWORKS[name];
  return { ...net, endpoints: { ...net.endpoints } };
}

/** List the available network names. */
export function listNetworks(): NetworkName[] {
  return Object.keys(NETWORKS) as NetworkName[];
}
