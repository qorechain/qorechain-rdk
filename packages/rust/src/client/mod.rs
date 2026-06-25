//! Read and broadcast clients over REST and the `qor_` JSON-RPC namespace, with
//! an injectable transport so tests do not hit the network.

pub mod facade;
pub mod http;
pub mod jsonrpc;
pub mod rest;
pub mod views;

pub use facade::{RdkClient, RdkClientOptions};
pub use http::{HttpError, HttpRequest, HttpResponse, ReqwestTransport, Transport};
pub use jsonrpc::QorClient;
pub use rest::{Coin, RestClient};
pub use views::{BatchView, ParamsView, RollupView};
