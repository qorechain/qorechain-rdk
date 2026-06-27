//! Rust Rollup Development Kit for the QoreChain network.
//!
//! This crate mirrors the TypeScript RDK (`@qorechain/rdk`): typed rollup
//! configuration with the compatibility matrix enforced client-side, the five
//! preset profiles, denom and economics helpers, binary Merkle withdrawal
//! proofs, a portable rollup manifest, read clients over REST and the `qor_`
//! JSON-RPC namespace, preflight/health/event helpers, account derivation, and
//! a signing transaction client that builds and broadcasts `rdk` messages.
//!
//! The enum and constant values mirror the on-chain `rdk` module exactly. The
//! string values are the wire values the chain expects -- do not localize or
//! re-case them. The documented parameter defaults are NOT a substitute for
//! live chain state: always read the authoritative values with the `rdk params`
//! query surface before acting on them.
//!
//! ```
//! use qorechain_rdk::presets::preset;
//! use qorechain_rdk::config::Profile;
//!
//! let config = preset(Profile::Defi)
//!     .set_rollup_id("my-defi-rollup")
//!     .build()
//!     .expect("valid config");
//! assert_eq!(config.profile, Profile::Defi);
//! ```

pub mod accounts;
pub mod bridge;
pub mod client;
pub mod config;
pub mod constants;
pub mod copilot;
pub mod da;
pub mod events;
pub mod faucet;
pub mod health;
pub mod manifest;
pub mod monitor;
pub mod preflight;
pub mod presets;
pub mod receipts;
pub mod tx;
pub mod utils;

pub use accounts::{signer_from_env, NativeAccount, Signer};
pub use client::{AnchorView, PqcAccountView, RdkClient, RdkClientOptions};
pub use copilot::{get_rollup_advice, CopilotSuggestion, RollupAdvice, SuggestionLevel};
pub use receipts::{
    anchor_sign_bytes, build_settlement_receipt, verify_settlement_receipt, ReceiptChecks,
    ReceiptError, ReceiptVerification, SettlementReceipt, RECEIPT_ALGORITHM, RECEIPT_VERSION,
};
pub use config::{
    BatchStatus, DaBackend, GasModel, Profile, ProofSystem, RollupConfig, RollupConfigBuilder,
    RollupConfigError, RollupStatus, Sequencer, SequencerParams, Settlement, ValidationResult,
    VmType,
};
pub use constants::*;
pub use da::{
    assert_da_backend_available, build_da_blob, is_da_backend_available, DaBlob, DaError,
    DA_CELESTIA_UNAVAILABLE_MESSAGE,
};
pub use monitor::{events_from_tx_hash, watch_rollup, Watcher};
pub use presets::{preset, preset_defaults};
pub use tx::{MockTxClient, RdkTxClient, TxOptions};
