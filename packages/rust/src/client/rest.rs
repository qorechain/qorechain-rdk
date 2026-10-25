//! Typed read client over the `rdk` REST (LCD) routes. This is the gRPC-gateway
//! HTTP surface, so it mirrors the gRPC query service one-to-one. It also hosts
//! the transaction-broadcast endpoint.

use std::collections::HashMap;

use serde_json::Value;
use thiserror::Error;

use super::http::{default_transport, HttpError, HttpRequest, Method, SharedTransport};
use super::views::{
    map_anchor_view, map_batch_view, map_params_view, map_pqc_account_view, map_rollup_view,
    AnchorView, BatchView, ParamsView, PqcAccountView, RollupView,
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

    /// One page of a rollup's batches, in index order, from `start_index`. The
    /// chain returns at most `limit` (0 means 50, capped at 100) and a next
    /// index that is 0 when there is no further page.
    pub fn list_batches_page(
        &self,
        rollup_id: &str,
        start_index: u64,
        limit: u32,
    ) -> Result<(Vec<BatchView>, u64), RestError> {
        let mut path = format!("/qorechain/rdk/v1/batches/{}", urlencode(rollup_id));
        let mut q = Vec::new();
        if start_index > 0 {
            q.push(format!("start_index={start_index}"));
        }
        if limit > 0 {
            q.push(format!("limit={limit}"));
        }
        if !q.is_empty() {
            path.push('?');
            path.push_str(&q.join("&"));
        }
        let body = self.get(&path)?;
        let batches = body
            .get("batches")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(map_batch_view).collect())
            .unwrap_or_default();
        let next = body
            .get("next_index")
            .or_else(|| body.get("nextIndex"))
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            })
            .unwrap_or(0);
        Ok((batches, next))
    }

    /// All settlement batches for a rollup, following every page.
    ///
    /// The chain's `Batches` query is paged (50 per page by default). Releases
    /// before 0.6.0 read only the first page, so nothing past batch #49 was ever
    /// returned.
    pub fn list_batches(&self, rollup_id: &str) -> Result<Vec<BatchView>, RestError> {
        self.list_batches_from(rollup_id, 0)
    }

    /// Every batch from `start_index` onwards, following pages.
    pub fn list_batches_from(
        &self,
        rollup_id: &str,
        start_index: u64,
    ) -> Result<Vec<BatchView>, RestError> {
        let mut out = Vec::new();
        let mut start = start_index;
        for _ in 0..100_000 {
            // bounded against a misbehaving node
            let (page, next) = self.list_batches_page(rollup_id, start, 100)?;
            let empty = page.is_empty();
            out.extend(page);
            if next == 0 || empty {
                break;
            }
            start = next;
        }
        Ok(out)
    }

    /// The latest settlement batch for a rollup (the chain's `LatestBatch`).
    ///
    /// Releases before 0.6.0 requested `/batches/{id}?latest=true`, which is not
    /// a chain route: the node returned the first page of the list, which was
    /// then read as one empty batch — so health reported "no batches yet" for
    /// every rollup.
    pub fn get_latest_batch(&self, rollup_id: &str) -> Result<BatchView, RestError> {
        let body = self.get(&format!(
            "/qorechain/rdk/v1/latest_batch/{}",
            urlencode(rollup_id)
        ))?;
        Ok(map_batch_view(Self::obj_or(&body, &["batch"])))
    }

    /// The chain's protocol switches (`/qorechain/pqc/v1/protocol_features`)
    /// as `(name, enabled)` pairs. Chains before the route existed answer 404
    /// or 501, which is returned as an error; see
    /// [`RestClient::is_protocol_feature_enabled`].
    pub fn get_protocol_features(&self) -> Result<Vec<(String, bool)>, RestError> {
        let body = self.get("/qorechain/pqc/v1/protocol_features")?;
        let list = body
            .get("features")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(list
            .iter()
            .map(|f| {
                (
                    f.get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    f.get("enabled") == Some(&Value::Bool(true)),
                )
            })
            .collect())
    }

    /// Whether the chain reports feature `name` as enabled. A chain that does
    /// not serve the feature route has none of its features, so an unavailable
    /// route (404/501) reads as `false`; other errors are returned.
    pub fn is_protocol_feature_enabled(&self, name: &str) -> Result<bool, RestError> {
        match self.get_protocol_features() {
            Ok(list) => Ok(list.iter().any(|(n, on)| n == name && *on)),
            Err(RestError::Status {
                status: 404 | 501, ..
            }) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// The height at which upgrade plan `name` was applied on this chain
    /// (`/cosmos/upgrade/v1beta1/applied_plan/{name}`), or 0 if it has not been.
    pub fn get_applied_plan_height(&self, name: &str) -> Result<i64, RestError> {
        let body = self.get(&format!(
            "/cosmos/upgrade/v1beta1/applied_plan/{}",
            urlencode(name)
        ))?;
        let h = match body.get("height") {
            Some(Value::String(s)) => s.parse().unwrap_or(0),
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
            _ => 0,
        };
        Ok(h.max(0))
    }

    /// Raw data-availability blob details (status, size, expiry).
    pub fn get_blob(&self, rollup_id: &str, blob_index: u64) -> Result<Value, RestError> {
        self.get(&format!(
            "/qorechain/rdk/v1/blob/{}/{}",
            urlencode(rollup_id),
            blob_index
        ))
    }

    /// The latest state anchor a layer committed to the Main Chain (the
    /// `x/multilayer` Anchor query). `layer_id` is the rollup's `layer_id`.
    pub fn get_anchor(&self, layer_id: &str) -> Result<AnchorView, RestError> {
        let body = self.get(&format!(
            "/qorechain/multilayer/v1/anchor/{}",
            urlencode(layer_id)
        ))?;
        Ok(map_anchor_view(Self::obj_or(&body, &["anchor"])))
    }

    /// Alias for [`RestClient::get_anchor`] — the chain's Anchor query returns
    /// the latest.
    pub fn get_latest_anchor(&self, layer_id: &str) -> Result<AnchorView, RestError> {
        self.get_anchor(layer_id)
    }

    /// All state anchors a layer has committed (newest first).
    pub fn get_anchors(&self, layer_id: &str) -> Result<Vec<AnchorView>, RestError> {
        let body = self.get(&format!(
            "/qorechain/multilayer/v1/anchors/{}",
            urlencode(layer_id)
        ))?;
        Ok(body
            .get("anchors")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(map_anchor_view).collect())
            .unwrap_or_default())
    }

    /// An account's post-quantum key record (the `x/pqc` account query). The
    /// `public_key` is the registered ML-DSA-87 (Dilithium-5) verification key.
    pub fn get_pqc_account(&self, address: &str) -> Result<PqcAccountView, RestError> {
        let body = self.get(&format!("/qorechain/pqc/v1/account/{}", urlencode(address)))?;
        Ok(map_pqc_account_view(Self::obj_or(&body, &["account"])))
    }

    // --- QCAI advisory reads (the `ai` REST surface) ---

    /// QCAI fee estimate; `urgency` is one of `low` | `normal` | `high`
    /// (optional).
    pub fn get_fee_estimate(&self, urgency: Option<&str>) -> Result<Value, RestError> {
        let q = match urgency {
            Some(u) => format!("?urgency={}", urlencode(u)),
            None => String::new(),
        };
        self.get(&format!("/qorechain/ai/v1/fee-estimate{q}"))
    }

    /// QCAI network recommendations (congestion, suggested settings).
    pub fn get_network_recommendations(&self) -> Result<Value, RestError> {
        self.get("/qorechain/ai/v1/network/recommendations")
    }

    /// Open fraud investigations across the network.
    pub fn get_fraud_investigations(&self) -> Result<Vec<Value>, RestError> {
        let body = self.get("/qorechain/ai/v1/fraud/investigations")?;
        let arr = body
            .get("investigations")
            .or_else(|| body.get("data"))
            .and_then(|v| v.as_array())
            .or_else(|| body.as_array());
        Ok(arr.cloned().unwrap_or_default())
    }

    /// A single fraud investigation by id.
    pub fn get_fraud_investigation(&self, id: &str) -> Result<Value, RestError> {
        self.get(&format!(
            "/qorechain/ai/v1/fraud/investigations/{}",
            urlencode(id)
        ))
    }

    /// Active QCAI circuit breakers (network safety throttles).
    pub fn get_circuit_breakers(&self) -> Result<Value, RestError> {
        self.get("/qorechain/ai/v1/circuit-breakers")
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

    /// All of an account's balances as `(denom, amount)` records.
    pub fn get_all_balances(&self, address: &str) -> Result<Vec<Coin>, RestError> {
        let body = self.get(&format!(
            "/cosmos/bank/v1beta1/balances/{}",
            urlencode(address)
        ))?;
        Ok(body
            .get("balances")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|c| Coin {
                        denom: value_to_string(c.get("denom"), ""),
                        amount: value_to_string(c.get("amount"), "0"),
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// A transaction by hash (the raw `/cosmos/tx/v1beta1/txs/{hash}` response).
    pub fn get_tx(&self, hash: &str) -> Result<Value, RestError> {
        self.get(&format!("/cosmos/tx/v1beta1/txs/{}", urlencode(hash)))
    }
}

/// A `{ denom, amount }` balance record, as returned by `get_all_balances`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coin {
    /// The denom (e.g. `uqor`).
    pub denom: String,
    /// The amount, as an integer string.
    pub amount: String,
}

/// Read a JSON value as a string, falling back to `default` when absent/null.
fn value_to_string(value: Option<&Value>, default: &str) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => default.to_string(),
        Some(other) => other.to_string(),
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
