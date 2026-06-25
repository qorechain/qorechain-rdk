//! A minimal, blocking HTTP transport abstraction so the clients are easy to
//! mock and test. The default implementation wraps a blocking [`reqwest`]
//! client; tests inject their own [`Transport`].

use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

/// An HTTP method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// HTTP GET.
    Get,
    /// HTTP POST.
    Post,
}

impl Method {
    /// The method name.
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
        }
    }
}

/// An outgoing HTTP request.
#[derive(Debug, Clone)]
pub struct HttpRequest {
    /// The HTTP method.
    pub method: Method,
    /// The absolute URL.
    pub url: String,
    /// Request headers.
    pub headers: HashMap<String, String>,
    /// Optional request body.
    pub body: Option<String>,
}

/// An HTTP response.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// The HTTP status code.
    pub status: u16,
    /// The response body text.
    pub body: String,
}

impl HttpResponse {
    /// Whether the status is 2xx.
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

/// A transport error.
#[derive(Debug, Clone, Error)]
#[error("HTTP transport error: {0}")]
pub struct HttpError(pub String);

/// A pluggable HTTP transport.
pub trait Transport: Send + Sync {
    /// Execute a request and return the response.
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError>;
}

/// The default transport, backed by a blocking [`reqwest`] client.
#[derive(Clone)]
pub struct ReqwestTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestTransport {
    /// Build a transport with a default blocking client.
    pub fn new() -> Self {
        ReqwestTransport {
            client: reqwest::blocking::Client::new(),
        }
    }

    /// Wrap an existing blocking client.
    pub fn with_client(client: reqwest::blocking::Client) -> Self {
        ReqwestTransport { client }
    }
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for ReqwestTransport {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let mut builder = match request.method {
            Method::Get => self.client.get(&request.url),
            Method::Post => self.client.post(&request.url),
        };
        for (k, v) in &request.headers {
            builder = builder.header(k.as_str(), v.as_str());
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let resp = builder.send().map_err(|e| HttpError(e.to_string()))?;
        let status = resp.status().as_u16();
        let body = resp.text().map_err(|e| HttpError(e.to_string()))?;
        Ok(HttpResponse { status, body })
    }
}

/// A shared, ref-counted transport handle the clients hold.
pub type SharedTransport = Arc<dyn Transport>;

/// Build the default shared transport.
pub fn default_transport() -> SharedTransport {
    Arc::new(ReqwestTransport::new())
}
