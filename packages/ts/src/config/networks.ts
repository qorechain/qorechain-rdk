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

const LOCALHOST_ENDPOINTS: Endpoints = {
  rest: "http://localhost:1317",
  rpc: "http://localhost:26657",
  grpc: "localhost:9090",
  evmRpc: "http://localhost:8545",
};

/** Built-in network presets. */
export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    chainId: CHAIN_IDS.testnet,
    endpoints: { ...LOCALHOST_ENDPOINTS },
  },
  mainnet: {
    name: "mainnet",
    chainId: CHAIN_IDS.mainnet,
    endpoints: { ...LOCALHOST_ENDPOINTS },
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
