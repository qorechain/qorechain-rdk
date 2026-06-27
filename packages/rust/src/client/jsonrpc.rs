//! Client for the custom `qor_` JSON-RPC namespace (served at the EVM JSON-RPC
//! endpoint): rollup status, batch status, the profile suggestion, and DA blob
//! status.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use thiserror::Error;

use super::http::{default_transport, HttpError, HttpRequest, Method, SharedTransport};

/// A JSON-RPC client error.
#[derive(Debug, Clone, Error)]
pub enum JsonRpcError {
    /// The transport failed.
    #[error(transparent)]
    Transport(#[from] HttpError),
    /// The server returned a non-2xx status.
    #[error("JSON-RPC {method} failed: {status}")]
    Status {
        /// The RPC method.
        method: String,
        /// The HTTP status code.
        status: u16,
    },
    /// The JSON-RPC envelope carried an error.
    #[error("JSON-RPC {method} error {code}: {message}")]
    Rpc {
        /// The RPC method.
        method: String,
        /// The error code.
        code: i64,
        /// The error message.
        message: String,
    },
    /// The response body was not valid JSON.
    #[error("JSON-RPC response was not valid JSON: {0}")]
    Json(String),
}

/// Client for the `qor_` JSON-RPC namespace.
#[derive(Clone)]
pub struct QorClient {
    url: String,
    transport: SharedTransport,
    id: Arc<AtomicU64>,
}

impl QorClient {
    /// Build a client against a JSON-RPC URL using the default transport.
    pub fn new(url: impl Into<String>) -> Self {
        Self::with_transport(url, default_transport())
    }

    /// Build a client with a custom transport.
    pub fn with_transport(url: impl Into<String>, transport: SharedTransport) -> Self {
        QorClient {
            url: url.into(),
            transport,
            id: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Make a raw `qor_*` JSON-RPC call, returning the `result` value.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, JsonRpcError> {
        let id = self.id.fetch_add(1, Ordering::SeqCst) + 1;
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/json".to_string());
        headers.insert("accept".to_string(), "application/json".to_string());
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let resp = self.transport.send(HttpRequest {
            method: Method::Post,
            url: self.url.clone(),
            headers,
            body: Some(body.to_string()),
        })?;
        if !resp.ok() {
            return Err(JsonRpcError::Status {
                method: method.to_string(),
                status: resp.status,
            });
        }
        let parsed: Value =
            serde_json::from_str(&resp.body).map_err(|e| JsonRpcError::Json(e.to_string()))?;
        if let Some(err) = parsed.get("error").filter(|e| !e.is_null()) {
            return Err(JsonRpcError::Rpc {
                method: method.to_string(),
                code: err.get("code").and_then(|c| c.as_i64()).unwrap_or(0),
                message: err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("")
                    .to_string(),
            });
        }
        Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Rollup configuration, status, and settlement mode.
    pub fn get_rollup_status(&self, rollup_id: &str) -> Result<Value, JsonRpcError> {
        self.call("qor_getRollupStatus", json!([rollup_id]))
    }

    /// All registered rollups with a status summary.
    pub fn list_rollups(&self) -> Result<Value, JsonRpcError> {
        self.call("qor_listRollups", json!([]))
    }

    /// Settlement batch details and finalization status.
    pub fn get_settlement_batch(
        &self,
        rollup_id: &str,
        batch_index: u64,
    ) -> Result<Value, JsonRpcError> {
        self.call("qor_getSettlementBatch", json!([rollup_id, batch_index]))
    }

    /// Assisted rollup profile recommendation for a use-case description.
    pub fn suggest_rollup_profile(&self, use_case: &str) -> Result<Value, JsonRpcError> {
        self.call("qor_suggestRollupProfile", json!([use_case]))
    }

    /// Data-availability blob storage status.
    pub fn get_da_blob_status(
        &self,
        rollup_id: &str,
        blob_index: u64,
    ) -> Result<Value, JsonRpcError> {
        self.call("qor_getDABlobStatus", json!([rollup_id, blob_index]))
    }

    /// QCAI reinforcement-learning agent status (the fee/routing policy agent).
    pub fn get_rl_agent_status(&self) -> Result<Value, JsonRpcError> {
        self.call("qor_getRLAgentStatus", json!([]))
    }

    /// The RL agent's current observation vector (network state it acts on).
    pub fn get_rl_observation(&self) -> Result<Value, JsonRpcError> {
        self.call("qor_getRLObservation", json!([]))
    }

    /// The RL agent's latest reward signal.
    pub fn get_rl_reward(&self) -> Result<Value, JsonRpcError> {
        self.call("qor_getRLReward", json!([]))
    }
}
