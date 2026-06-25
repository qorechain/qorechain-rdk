//! A mock tx backend -- the offline "devnet" equivalent.
//!
//! [`MockTxClient`] is a recording [`Transport`](crate::client::http::Transport):
//! drop it into a [`RestClient`](crate::client::rest::RestClient) and build an
//! [`RdkTxClient`](crate::tx::RdkTxClient) on top to exercise the full
//! create/submit/lifecycle flow without a node. It records every broadcast call
//! and returns a successful, fake transaction result.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::client::http::{
    HttpError, HttpRequest, HttpResponse, Method, SharedTransport, Transport,
};

/// The default gas reported by [`MockTxClient::simulate`] and in the fake result.
pub const DEFAULT_MOCK_GAS_ESTIMATE: u64 = 120_000;

/// The transaction hash returned in the fake broadcast result.
pub const MOCK_TX_HASH: &str = "MOCK_TX_HASH";

/// A recorded broadcast call: the path, the base64 `tx_bytes`, and the mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockCall {
    /// The request path that was posted to.
    pub path: String,
    /// The base64-encoded `tx_bytes` from the broadcast body.
    pub tx_bytes: String,
    /// The broadcast mode (e.g. `BROADCAST_MODE_SYNC`).
    pub mode: String,
}

/// A mock tx transport that records broadcasts and returns a fake success.
///
/// Construct one, share it (`Arc`), hand the clone to a `RestClient`, and inspect
/// [`MockTxClient::calls`] afterwards.
pub struct MockTxClient {
    calls: Mutex<Vec<MockCall>>,
    gas_estimate: u64,
    tx_hash: String,
}

impl MockTxClient {
    /// A mock client with the default gas estimate and tx hash.
    pub fn new() -> Self {
        MockTxClient {
            calls: Mutex::new(Vec::new()),
            gas_estimate: DEFAULT_MOCK_GAS_ESTIMATE,
            tx_hash: MOCK_TX_HASH.to_string(),
        }
    }

    /// Override the gas returned from `simulate` and reported as used.
    pub fn with_gas_estimate(mut self, gas_estimate: u64) -> Self {
        self.gas_estimate = gas_estimate;
        self
    }

    /// Override the transaction hash returned in the fake result.
    pub fn with_tx_hash(mut self, tx_hash: impl Into<String>) -> Self {
        self.tx_hash = tx_hash.into();
        self
    }

    /// The gas estimate this mock reports.
    pub fn gas_estimate(&self) -> u64 {
        self.gas_estimate
    }

    /// Every recorded broadcast call, in order.
    pub fn calls(&self) -> Vec<MockCall> {
        self.calls.lock().unwrap().clone()
    }

    /// The number of broadcast calls recorded.
    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }

    /// Wrap this mock as a shared transport for a `RestClient`.
    pub fn into_transport(self) -> SharedTransport {
        std::sync::Arc::new(self)
    }

    fn fake_response(&self) -> Value {
        json!({
            "tx_response": {
                "code": 0,
                "height": "1",
                "txhash": self.tx_hash,
                "raw_log": "",
                "gas_used": self.gas_estimate.to_string(),
                "gas_wanted": self.gas_estimate.to_string(),
                "events": [],
            }
        })
    }
}

impl Default for MockTxClient {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for MockTxClient {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        if request.method == Method::Post {
            let path = request
                .url
                .split_once("://")
                .and_then(|(_, rest)| rest.split_once('/'))
                .map(|(_, p)| format!("/{p}"))
                .unwrap_or_else(|| request.url.clone());
            let body: Value = request
                .body
                .as_deref()
                .and_then(|b| serde_json::from_str(b).ok())
                .unwrap_or(Value::Null);
            self.calls.lock().unwrap().push(MockCall {
                path,
                tx_bytes: body
                    .get("tx_bytes")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                mode: body
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            });
        }
        Ok(HttpResponse {
            status: 200,
            body: self.fake_response().to_string(),
        })
    }
}
