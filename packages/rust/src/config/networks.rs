//! Named network presets. The RDK defaults to testnet. Each preset ships the
//! network's public endpoints; override them (e.g. with [`Endpoints::localhost`])
//! to reach a local node or your own infrastructure.

use crate::constants::Network;

/// Endpoint URLs the RDK talks to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// Cosmos REST (LCD) -- rollup/batch/DA/params reads and tx broadcast.
    pub rest: String,
    /// Consensus RPC.
    pub rpc: String,
    /// gRPC (host:port) -- typed queries (parity with REST).
    pub grpc: String,
    /// EVM + `qor_` JSON-RPC -- the custom `qor_*` rollup methods.
    pub evm_rpc: String,
}

impl Endpoints {
    /// The localhost endpoint defaults, for running against a local node.
    pub fn localhost() -> Self {
        Endpoints {
            rest: "http://localhost:1317".to_string(),
            rpc: "http://localhost:26657".to_string(),
            grpc: "localhost:9090".to_string(),
            evm_rpc: "http://localhost:8545".to_string(),
        }
    }

    /// The public mainnet endpoints (`qorechain-vladi`).
    pub fn mainnet() -> Self {
        Endpoints {
            rest: "https://api.qore.host".to_string(),
            rpc: "https://rpc.qore.host".to_string(),
            grpc: "grpc.qore.host:443".to_string(),
            evm_rpc: "https://evm.qore.host".to_string(),
        }
    }

    /// The public testnet endpoints (`qorechain-diana`).
    pub fn testnet() -> Self {
        Endpoints {
            rest: "https://api-testnet.qore.host".to_string(),
            rpc: "https://rpc-testnet.qore.host".to_string(),
            grpc: "grpc-testnet.qore.host:443".to_string(),
            evm_rpc: "https://evm-testnet.qore.host".to_string(),
        }
    }

    /// The public endpoints for a network.
    pub fn for_network(network: Network) -> Self {
        match network {
            Network::Testnet => Endpoints::testnet(),
            Network::Mainnet => Endpoints::mainnet(),
        }
    }
}

/// A resolved network: its chain id and endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkConfig {
    /// The network.
    pub name: Network,
    /// The chain id.
    pub chain_id: String,
    /// The resolved endpoints.
    pub endpoints: Endpoints,
}

/// Look up a network preset by name. Each preset ships the network's public
/// endpoints; override `endpoints` (e.g. with [`Endpoints::localhost`]) to point
/// at a local node or your own infrastructure.
pub fn get_network(name: Network) -> NetworkConfig {
    NetworkConfig {
        name,
        chain_id: name.chain_id().to_string(),
        endpoints: Endpoints::for_network(name),
    }
}

/// List the available networks.
pub fn list_networks() -> Vec<Network> {
    vec![Network::Testnet, Network::Mainnet]
}
