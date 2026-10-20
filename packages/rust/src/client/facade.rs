//! `RdkClient` -- the high-level read entry point. Resolves a network, composes
//! the REST and `qor_` JSON-RPC read clients, and exposes the assisted profile
//! suggestion.

use crate::config::{get_network, Endpoints, NetworkConfig, Profile, PROFILE_NAMES};
use crate::constants::Network;

use super::http::{default_transport, SharedTransport};
use super::jsonrpc::QorClient;
use super::rest::RestClient;
use super::views::ParamsView;

/// Options for constructing an [`RdkClient`].
#[derive(Default)]
pub struct RdkClientOptions {
    /// Network preset (default `testnet`).
    pub network: Option<Network>,
    /// REST endpoint override.
    pub rest_url: Option<String>,
    /// `qor_` JSON-RPC endpoint override.
    pub evm_rpc_url: Option<String>,
    /// Consensus RPC endpoint override (used for the chain tip).
    pub rpc_url: Option<String>,
    /// Custom transport (for testing or non-standard environments).
    pub transport: Option<SharedTransport>,
}

/// The source of a profile suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionSource {
    /// Came from the advisory service.
    Advisory,
    /// Came from the documented fallback.
    Fallback,
}

/// The result of a profile suggestion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileSuggestion {
    /// The recommended profile.
    pub profile: Profile,
    /// Whether the suggestion came from the advisory service or the fallback.
    pub source: SuggestionSource,
}

/// The high-level read client.
pub struct RdkClient {
    /// The resolved network (chain id and endpoints).
    pub network: NetworkConfig,
    /// REST (LCD) read client.
    pub rest: RestClient,
    /// `qor_` JSON-RPC client.
    pub qor: QorClient,
    transport: SharedTransport,
}

impl RdkClient {
    /// Build a client from options.
    pub fn new(options: RdkClientOptions) -> Self {
        let mut net = get_network(options.network.unwrap_or_default());
        let endpoints = Endpoints {
            rest: options.rest_url.unwrap_or(net.endpoints.rest),
            rpc: options.rpc_url.unwrap_or(net.endpoints.rpc),
            grpc: net.endpoints.grpc,
            evm_rpc: options.evm_rpc_url.unwrap_or(net.endpoints.evm_rpc),
        };
        net.endpoints = endpoints;
        let transport = options.transport.unwrap_or_else(default_transport);
        let rest = RestClient::with_transport(net.endpoints.rest.clone(), transport.clone());
        let qor = QorClient::with_transport(net.endpoints.evm_rpc.clone(), transport.clone());
        RdkClient {
            network: net,
            rest,
            qor,
            transport,
        }
    }

    /// The chain tip — latest height and its block time — from the consensus
    /// RPC's `/status`. A challenge window is judged against this, not the local
    /// clock: the block-count path counts heights, and the time-based path
    /// compares block time, which can lag wall time.
    pub fn get_chain_tip(
        &self,
    ) -> Result<crate::challenge_window::ChainTip, super::rest::RestError> {
        use super::http::{HttpRequest, Method};
        let url = format!(
            "{}/status",
            self.network.endpoints.rpc.trim_end_matches('/')
        );
        let res = self
            .transport
            .send(HttpRequest {
                method: Method::Get,
                url: url.clone(),
                headers: Default::default(),
                body: None,
            })
            .map_err(super::rest::RestError::Transport)?;
        if !res.ok() {
            return Err(super::rest::RestError::Transport(super::http::HttpError(
                format!(
                    "could not read the chain tip from {url} (HTTP {})",
                    res.status
                ),
            )));
        }
        let body: serde_json::Value = serde_json::from_str(&res.body).map_err(|e| {
            super::rest::RestError::Transport(super::http::HttpError(format!(
                "could not decode {url}: {e}"
            )))
        })?;
        let info = &body["result"]["sync_info"];
        let height = info["latest_block_height"]
            .as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .ok_or_else(|| {
                super::rest::RestError::Transport(super::http::HttpError(format!(
                    "the node at {url} did not report a latest block height"
                )))
            })?;
        let time_secs = info["latest_block_time"]
            .as_str()
            .and_then(crate::challenge_window::rfc3339_utc_to_unix)
            .ok_or_else(|| {
                super::rest::RestError::Transport(super::http::HttpError(format!(
                    "the node at {url} did not report a latest block time"
                )))
            })?;
        Ok(crate::challenge_window::ChainTip { height, time_secs })
    }

    /// Build a client with default testnet settings.
    pub fn testnet() -> Self {
        Self::new(RdkClientOptions::default())
    }

    /// Read the live `rdk` module parameters from the chain.
    pub fn params(&self) -> Result<ParamsView, super::rest::RestError> {
        self.rest.get_params()
    }

    /// Assisted profile suggestion, with a documented fallback to `defi`.
    pub fn suggest_profile(&self, use_case: &str, fallback: Option<Profile>) -> ProfileSuggestion {
        let fallback = fallback.unwrap_or(Profile::Defi);
        match self.qor.suggest_rollup_profile(use_case) {
            Ok(result) => match extract_profile(&result) {
                Some(profile) => ProfileSuggestion {
                    profile,
                    source: SuggestionSource::Advisory,
                },
                None => ProfileSuggestion {
                    profile: fallback,
                    source: SuggestionSource::Fallback,
                },
            },
            Err(_) => ProfileSuggestion {
                profile: fallback,
                source: SuggestionSource::Fallback,
            },
        }
    }
}

fn parse_profile(s: &str) -> Option<Profile> {
    PROFILE_NAMES.iter().copied().find(|p| p.as_str() == s)
}

fn extract_profile(result: &serde_json::Value) -> Option<Profile> {
    if let Some(s) = result.as_str() {
        if let Some(p) = parse_profile(s) {
            return Some(p);
        }
    }
    if let Some(obj) = result.as_object() {
        for key in [
            "profile",
            "suggestedProfile",
            "suggested_profile",
            "recommendation",
        ] {
            if let Some(v) = obj.get(key).and_then(|v| v.as_str()) {
                if let Some(p) = parse_profile(v) {
                    return Some(p);
                }
            }
        }
    }
    None
}
