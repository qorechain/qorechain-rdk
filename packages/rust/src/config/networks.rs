//! Named network presets. The RDK defaults to testnet. Endpoint defaults point
//! at localhost -- override them to reach a real node.

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
    /// The localhost endpoint defaults.
    pub fn localhost() -> Self {
        Endpoints {
            rest: "http://localhost:1317".to_string(),
            rpc: "http://localhost:26657".to_string(),
            grpc: "localhost:9090".to_string(),
            evm_rpc: "http://localhost:8545".to_string(),
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

/// Look up a network preset by name.
pub fn get_network(name: Network) -> NetworkConfig {
    NetworkConfig {
        name,
        chain_id: name.chain_id().to_string(),
        endpoints: Endpoints::localhost(),
    }
}

/// List the available networks.
pub fn list_networks() -> Vec<Network> {
    vec![Network::Testnet, Network::Mainnet]
}
