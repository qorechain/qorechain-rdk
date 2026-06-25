//! Typed read client over the `rdk` REST (LCD) routes. This is the gRPC-gateway
//! HTTP surface, so it mirrors the gRPC query service one-to-one. It also hosts
//! the transaction-broadcast endpoint.

use std::collections::HashMap;

use serde_json::Value;
use thiserror::Error;

use super::http::{default_transport, HttpError, HttpRequest, Method, SharedTransport};
use super::views::{
    map_batch_view, map_params_view, map_rollup_view, BatchView, ParamsView, RollupView,
};

/// A REST client error.
#[derive(Debug, Clone, Error)]
pub enum RestError {
    /// The transport failed.
    #[error(transparent)]
    Transport(#[from] HttpError),
    /// The server returned a non-2xx status.
    #[error("REST {method} {path} failed: {status}")]
    Status {
        /// The HTTP method.
        method: String,
        /// The request path.
        path: String,
        /// The HTTP status code.
        status: u16,
    },
    /// The response body was not valid JSON.
    #[error("REST response was not valid JSON: {0}")]
    Json(String),
}

/// Typed read/broadcast client over the `rdk` REST routes.
#[derive(Clone)]
pub struct RestClient {
    base: String,
    transport: SharedTransport,
}

impl RestClient {
    /// Build a client against a base URL using the default transport.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self::with_transport(base_url, default_transport())
    }

    /// Build a client with a custom transport (for testing or non-standard
    /// environments).
    pub fn with_transport(base_url: impl Into<String>, transport: SharedTransport) -> Self {
        let base = base_url.into().trim_end_matches('/').to_string();
        RestClient { base, transport }
    }

    /// The shared transport handle.
    pub fn transport(&self) -> SharedTransport {
        self.transport.clone()
    }

    fn get(&self, path: &str) -> Result<Value, RestError> {
        let mut headers = HashMap::new();
        headers.insert("accept".to_string(), "application/json".to_string());
        let resp = self.transport.send(HttpRequest {
            method: Method::Get,
            url: format!("{}{}", self.base, path),
            headers,
            body: None,
        })?;
        if !resp.ok() {
            return Err(RestError::Status {
                method: "GET".to_string(),
                path: path.to_string(),
                status: resp.status,
            });
        }
        serde_json::from_str(&resp.body).map_err(|e| RestError::Json(e.to_string()))
    }

    /// POST a JSON body and return the parsed response (used for broadcast).
    pub fn post_json(&self, path: &str, body: String) -> Result<Value, RestError> {
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/json".to_string());
        headers.insert("accept".to_string(), "application/json".to_string());
        let resp = self.transport.send(HttpRequest {
            method: Method::Post,
            url: format!("{}{}", self.base, path),
            headers,
            body: Some(body),
        })?;
        if !resp.ok() {
            return Err(RestError::Status {
                method: "POST".to_string(),
                path: path.to_string(),
                status: resp.status,
            });
        }
        serde_json::from_str(&resp.body).map_err(|e| RestError::Json(e.to_string()))
    }

    fn obj_or<'a>(body: &'a Value, keys: &[&str]) -> &'a Value {
        for k in keys {
            if let Some(v) = body.get(*k) {
                if !v.is_null() {
                    return v;
                }
            }
        }
        body
    }

    /// Live module parameters.
    pub fn get_params(&self) -> Result<ParamsView, RestError> {
        let body = self.get("/qorechain/rdk/v1/params")?;
        Ok(map_params_view(Self::obj_or(&body, &["params"])))
    }

    /// A single rollup's configuration and status.
    pub fn get_rollup(&self, rollup_id: &str) -> Result<RollupView, RestError> {
        let body = self.get(&format!(
            "/qorechain/rdk/v1/rollup/{}",
            urlencode(rollup_id)
        ))?;
        Ok(map_rollup_view(Self::obj_or(&body, &["rollup"])))
    }

    /// All registered rollups.
    pub fn list_rollups(&self) -> Result<Vec<RollupView>, RestError> {
        let body = self.get("/qorechain/rdk/v1/rollups")?;
        Ok(body
            .get("rollups")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(map_rollup_view).collect())
            .unwrap_or_default())
    }

    /// A settlement batch by index.
    pub fn get_batch(&self, rollup_id: &str, batch_index: u64) -> Result<BatchView, RestError> {
        let body = self.get(&format!(
            "/qorechain/rdk/v1/batch/{}/{}",
            urlencode(rollup_id),
            batch_index
        ))?;
        Ok(map_batch_view(Self::obj_or(&body, &["batch"])))
    }

    /// All settlement batches for a rollup.
    pub fn list_batches(&self, rollup_id: &str) -> Result<Vec<BatchView>, RestError> {
        let body = self.get(&format!(
            "/qorechain/rdk/v1/batches/{}",
            urlencode(rollup_id)
        ))?;
        Ok(body
            .get("batches")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(map_batch_view).collect())
            .unwrap_or_default())
    }

    /// The latest settlement batch for a rollup.
    pub fn get_latest_batch(&self, rollup_id: &str) -> Result<BatchView, RestError> {
        let body = self.get(&format!(
            "/qorechain/rdk/v1/batches/{}?latest=true",
            urlencode(rollup_id)
        ))?;
        Ok(map_batch_view(Self::obj_or(&body, &["batch"])))
    }

    /// An account's balance for a single denom (default `uqor`), as an integer
    /// string.
    pub fn get_balance(&self, address: &str, denom: &str) -> Result<String, RestError> {
        let body = self.get(&format!(
            "/cosmos/bank/v1beta1/balances/{}/by_denom?denom={}",
            urlencode(address),
            urlencode(denom)
        ))?;
        let balance = body.get("balance");
        let amount = balance
            .and_then(|b| b.get("amount"))
            .map(|a| match a {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_else(|| "0".to_string());
        Ok(amount)
    }
}

/// Percent-encode a path segment (RFC 3986 unreserved set is kept verbatim).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
