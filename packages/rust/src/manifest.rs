//! Rollup manifest -- a portable JSON snapshot of a rollup's resolved
//! configuration, target network, endpoints, and key addresses. Save it, share
//! it, and load it back into a config builder.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::{Endpoints, RollupConfig, RollupConfigBuilder};
use crate::constants::Network;

/// The manifest schema identifier.
pub const MANIFEST_SCHEMA: &str = "qorechain-rdk/rollup-manifest";

/// A partial endpoint set for serialization (all fields optional).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartialEndpoints {
    /// Cosmos REST (LCD).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rest: Option<String>,
    /// Consensus RPC.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc: Option<String>,
    /// gRPC host:port.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grpc: Option<String>,
    /// EVM + `qor_` JSON-RPC.
    #[serde(rename = "evmRpc", skip_serializing_if = "Option::is_none")]
    pub evm_rpc: Option<String>,
}

impl From<&Endpoints> for PartialEndpoints {
    fn from(e: &Endpoints) -> Self {
        PartialEndpoints {
            rest: Some(e.rest.clone()),
            rpc: Some(e.rpc.clone()),
            grpc: Some(e.grpc.clone()),
            evm_rpc: Some(e.evm_rpc.clone()),
        }
    }
}

/// The network as a wire string, serialized/deserialized via `testnet`/`mainnet`.
fn network_to_str(net: &Network) -> String {
    net.as_str().to_string()
}

/// A portable rollup manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RollupManifest {
    /// The schema identifier (must equal [`MANIFEST_SCHEMA`]).
    pub schema: String,
    /// The manifest version (always `1`).
    pub version: u32,
    /// Target network.
    #[serde(serialize_with = "ser_network", deserialize_with = "de_network")]
    pub network: Network,
    /// Chain id.
    #[serde(rename = "chainId", skip_serializing_if = "Option::is_none")]
    pub chain_id: Option<String>,
    /// Endpoint overrides.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoints: Option<PartialEndpoints>,
    /// The resolved rollup configuration.
    pub config: RollupConfig,
    /// Named addresses (e.g. creator, sequencer).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addresses: Option<BTreeMap<String, String>>,
    /// Caller-stamped ISO timestamp (the kit does not read the clock).
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Free-form notes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<Vec<String>>,
}

fn ser_network<Sz: serde::Serializer>(net: &Network, s: Sz) -> Result<Sz::Ok, Sz::Error> {
    s.serialize_str(&network_to_str(net))
}

fn de_network<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Network, D::Error> {
    let s = String::deserialize(d)?;
    match s.as_str() {
        "testnet" => Ok(Network::Testnet),
        "mainnet" => Ok(Network::Mainnet),
        other => Err(serde::de::Error::custom(format!(
            "unknown network: {other}"
        ))),
    }
}

/// Options for building a manifest.
#[derive(Debug, Clone, Default)]
pub struct ToManifestOptions {
    /// Target network.
    pub network: Network,
    /// Chain id.
    pub chain_id: Option<String>,
    /// Endpoint overrides.
    pub endpoints: Option<PartialEndpoints>,
    /// Named addresses.
    pub addresses: Option<BTreeMap<String, String>>,
    /// Caller-stamped timestamp.
    pub created_at: Option<String>,
    /// Free-form notes.
    pub notes: Option<Vec<String>>,
}

/// A manifest error.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ManifestError {
    /// The JSON could not be (de)serialized.
    #[error("manifest serialization failed: {0}")]
    Serde(String),
    /// The JSON was not a qorechain-rdk manifest.
    #[error("not a qorechain-rdk rollup manifest")]
    WrongSchema,
}

/// Build a manifest from a resolved config.
pub fn to_manifest(config: RollupConfig, options: ToManifestOptions) -> RollupManifest {
    RollupManifest {
        schema: MANIFEST_SCHEMA.to_string(),
        version: 1,
        network: options.network,
        chain_id: options.chain_id,
        endpoints: options.endpoints,
        config,
        addresses: options.addresses,
        created_at: options.created_at,
        notes: options.notes,
    }
}

/// Load a manifest into a [`RollupConfigBuilder`].
pub fn from_manifest(manifest: &RollupManifest) -> Result<RollupConfigBuilder, ManifestError> {
    if manifest.schema != MANIFEST_SCHEMA {
        return Err(ManifestError::WrongSchema);
    }
    Ok(RollupConfigBuilder::new(manifest.config.clone()))
}

/// Parse a manifest from JSON text.
pub fn parse_manifest(json: &str) -> Result<RollupManifest, ManifestError> {
    let manifest: RollupManifest =
        serde_json::from_str(json).map_err(|e| ManifestError::Serde(e.to_string()))?;
    if manifest.schema != MANIFEST_SCHEMA {
        return Err(ManifestError::WrongSchema);
    }
    Ok(manifest)
}

/// Serialize a manifest to pretty JSON (trailing newline).
pub fn stringify_manifest(manifest: &RollupManifest) -> Result<String, ManifestError> {
    let s =
        serde_json::to_string_pretty(manifest).map_err(|e| ManifestError::Serde(e.to_string()))?;
    Ok(format!("{s}\n"))
}
