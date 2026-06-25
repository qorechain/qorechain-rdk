//! Testnet faucet helper. The network does not publish a fixed faucet endpoint,
//! so this posts to a URL you supply. It fails with a clear message when no URL
//! is configured rather than guessing one.

use std::collections::HashMap;

use serde_json::{json, Value};
use thiserror::Error;

use crate::client::http::{default_transport, HttpError, HttpRequest, Method, SharedTransport};
use crate::constants::BASE_DENOM;

/// A faucet request error.
#[derive(Debug, Clone, Error)]
pub enum FaucetError {
    /// No faucet URL was configured.
    #[error(
        "No faucet URL configured. Set a faucet endpoint or fund the account manually -- see the keys & funding guide."
    )]
    NoUrl,
    /// The transport failed.
    #[error(transparent)]
    Transport(#[from] HttpError),
    /// The faucet returned a non-2xx status.
    #[error("Faucet request failed: {0}")]
    Status(u16),
}

/// The result of a faucet request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaucetResult {
    /// The HTTP status code.
    pub status: u16,
    /// The parsed response body, if any.
    pub body: Option<Value>,
}

/// Request testnet funds from a configured faucet URL.
pub fn request_faucet(
    url: Option<&str>,
    address: &str,
    denom: Option<&str>,
    transport: Option<SharedTransport>,
) -> Result<FaucetResult, FaucetError> {
    let url = match url {
        Some(u) if !u.trim().is_empty() => u,
        _ => return Err(FaucetError::NoUrl),
    };
    let transport = transport.unwrap_or_else(default_transport);
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());
    headers.insert("accept".to_string(), "application/json".to_string());
    let body = json!({ "address": address, "denom": denom.unwrap_or(BASE_DENOM) });
    let resp = transport.send(HttpRequest {
        method: Method::Post,
        url: url.to_string(),
        headers,
        body: Some(body.to_string()),
    })?;
    if !resp.ok() {
        return Err(FaucetError::Status(resp.status));
    }
    let parsed = serde_json::from_str(&resp.body).ok();
    Ok(FaucetResult {
        status: resp.status,
        body: parsed,
    })
}
