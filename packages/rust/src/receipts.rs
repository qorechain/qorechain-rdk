//! Quantum-Safe Settlement Receipts.
//!
//! A settlement receipt is a portable, self-contained proof that a rollup's
//! settlement batch was anchored to the QoreChain Main Chain under a
//! post-quantum (ML-DSA-87 / Dilithium-5) signature. It can be verified fully
//! offline: reconstruct the canonical anchor message, fetch (or supply) the
//! layer creator's registered PQC key, and check the Dilithium-5 signature plus
//! the batch <-> anchor state-root binding.
//!
//! Canonical anchor message (matches the chain's `anchorSignBytes`):
//! `layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash`.

use serde::{Deserialize, Serialize};

use crate::client::facade::RdkClient;
use crate::client::views::AnchorView;
use crate::utils::bytes::{decode_wire_bytes, hex_to_bytes};

/// The post-quantum algorithm the anchor signature uses.
pub const RECEIPT_ALGORITHM: &str = "ML-DSA-87";

/// Current receipt schema version.
pub const RECEIPT_VERSION: u32 = 1;

/// An error building or verifying a settlement receipt.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ReceiptError {
    /// A REST read failed.
    #[error(transparent)]
    Rest(#[from] crate::client::rest::RestError),
    /// The rollup is not anchored to a multilayer layer.
    #[error("rollup \"{0}\" has no layer_id — it is not anchored to a multilayer layer")]
    NoLayer(String),
    /// No state anchor exists for the layer yet.
    #[error("no state anchor found for layer \"{0}\"")]
    NoAnchor(String),
    /// No anchor commits the batch's state root yet.
    #[error(
        "no anchor commits batch {batch_index}'s state root yet (latest anchored height {latest_height}); the batch may not be anchored to the Main Chain"
    )]
    NotAnchored {
        /// The batch index requested.
        batch_index: u64,
        /// The latest anchored layer height seen.
        latest_height: u64,
    },
}

/// A portable, offline-verifiable settlement receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettlementReceipt {
    /// Receipt schema version.
    pub version: u32,
    /// The rollup id.
    pub rollup_id: String,
    /// The host layer id.
    pub layer_id: String,
    /// The settlement batch index.
    pub batch_index: u64,
    /// The layer creator — the registered signer of the anchor's PQC signature.
    pub creator: String,
    /// The post-quantum algorithm name.
    pub algorithm: String,
    /// The anchored state root (hex).
    pub state_root: String,
    /// The anchored layer height.
    pub layer_height: u64,
    /// The anchored validator-set hash (hex).
    pub validator_set_hash: String,
    /// The Main Chain height the anchor was committed at.
    pub main_chain_height: i64,
    /// Anchor unix timestamp (seconds).
    pub anchored_at: i64,
    /// The Dilithium-5 anchor signature (hex).
    pub pqc_signature: String,
    /// The state root read from the settlement batch (hex), for the binding check.
    pub batch_state_root: String,
}

/// The individual checks of a receipt verification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptChecks {
    /// The batch's state root equals the anchored state root.
    pub state_root_binding: bool,
    /// The Dilithium-5 signature over the canonical message verified.
    pub pqc_signature: bool,
    /// A non-empty signature and key were present to check.
    pub has_material: bool,
}

/// The outcome of verifying a receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptVerification {
    /// Whether the receipt is valid (binding + signature both hold).
    pub valid: bool,
    /// The individual checks.
    pub checks: ReceiptChecks,
    /// A human-readable reason when invalid.
    pub reason: Option<String>,
}

/// Reconstruct the canonical message the chain signs for a state anchor:
/// `layer_id || layer_height(8B BE) || state_root || validator_set_hash`.
/// Inputs are taken in hex (`state_root_hex`, `vsh_hex`) and a numeric height.
pub fn anchor_sign_bytes(
    layer_id: &str,
    layer_height: u64,
    state_root_hex: &str,
    vsh_hex: &str,
) -> Vec<u8> {
    let state_root = hex_to_bytes(state_root_hex).unwrap_or_default();
    let vsh = hex_to_bytes(vsh_hex).unwrap_or_default();
    let mut out = Vec::with_capacity(layer_id.len() + 8 + state_root.len() + vsh.len());
    out.extend_from_slice(layer_id.as_bytes());
    out.extend_from_slice(&layer_height.to_be_bytes());
    out.extend_from_slice(&state_root);
    out.extend_from_slice(&vsh);
    out
}

fn receipt_from_parts(
    rollup_id: &str,
    layer_id: &str,
    batch_index: u64,
    creator: &str,
    anchor: &AnchorView,
    batch_state_root_hex: &str,
) -> SettlementReceipt {
    SettlementReceipt {
        version: RECEIPT_VERSION,
        rollup_id: rollup_id.to_string(),
        layer_id: layer_id.to_string(),
        batch_index,
        creator: creator.to_string(),
        algorithm: RECEIPT_ALGORITHM.to_string(),
        state_root: anchor.state_root.clone(),
        layer_height: anchor.layer_height,
        validator_set_hash: anchor.validator_set_hash.clone(),
        main_chain_height: anchor.main_chain_height,
        anchored_at: anchor.anchored_at,
        pqc_signature: anchor.pqc_signature.clone(),
        batch_state_root: batch_state_root_hex.to_string(),
    }
}

/// Build a settlement receipt for `rollup_id`'s batch `batch_index`: resolve the
/// rollup's layer, read the batch's state root, and find the state anchor that
/// commits that root to the Main Chain. Errors if the rollup has no layer, the
/// batch is missing, or no anchor covers the batch's state root yet.
pub fn build_settlement_receipt(
    client: &RdkClient,
    rollup_id: &str,
    batch_index: u64,
) -> Result<SettlementReceipt, ReceiptError> {
    let rollup = client.rest.get_rollup(rollup_id)?;
    if rollup.layer_id.is_empty() {
        return Err(ReceiptError::NoLayer(rollup_id.to_string()));
    }
    let batch = client.rest.get_batch(rollup_id, batch_index)?;
    let batch_state_root_hex = if batch.state_root.is_empty() {
        String::new()
    } else {
        crate::utils::bytes::bytes_to_hex(&decode_wire_bytes(&batch.state_root))
    };

    let anchors = client.rest.get_anchors(&rollup.layer_id)?;
    let covering = anchors
        .iter()
        .find(|a| !a.state_root.is_empty() && a.state_root == batch_state_root_hex)
        .cloned();
    let anchor = match covering.clone() {
        Some(a) => a,
        None => client.rest.get_latest_anchor(&rollup.layer_id)?,
    };
    if anchor.state_root.is_empty() {
        return Err(ReceiptError::NoAnchor(rollup.layer_id.clone()));
    }
    if covering.is_none() {
        return Err(ReceiptError::NotAnchored {
            batch_index,
            latest_height: anchor.layer_height,
        });
    }
    Ok(receipt_from_parts(
        rollup_id,
        &rollup.layer_id,
        batch_index,
        &rollup.creator,
        &anchor,
        &batch_state_root_hex,
    ))
}

/// Verify a settlement receipt: the batch <-> anchor state-root binding and the
/// Dilithium-5 signature over the canonical anchor message. With
/// `creator_public_key_hex` supplied this is fully offline; otherwise `client`
/// fetches the creator's registered post-quantum key.
pub fn verify_settlement_receipt(
    receipt: &SettlementReceipt,
    creator_public_key_hex: Option<&str>,
    client: Option<&RdkClient>,
) -> ReceiptVerification {
    let mut checks = ReceiptChecks {
        state_root_binding: false,
        pqc_signature: false,
        has_material: false,
    };

    checks.state_root_binding =
        !receipt.state_root.is_empty() && receipt.state_root == receipt.batch_state_root;

    let public_key_hex: String = match creator_public_key_hex {
        Some(pk) => pk.to_string(),
        None => match client {
            None => {
                return ReceiptVerification {
                    valid: false,
                    checks,
                    reason: Some(
                        "no creator_public_key_hex supplied and no client to fetch the creator's PQC key"
                            .to_string(),
                    ),
                };
            }
            Some(c) => match c.rest.get_pqc_account(&receipt.creator) {
                Ok(account) => account.public_key,
                Err(e) => {
                    return ReceiptVerification {
                        valid: false,
                        checks,
                        reason: Some(format!("failed to fetch creator PQC key: {e}")),
                    };
                }
            },
        },
    };

    checks.has_material = !public_key_hex.is_empty() && !receipt.pqc_signature.is_empty();
    if !checks.has_material {
        return ReceiptVerification {
            valid: false,
            checks,
            reason: Some("missing public key or anchor signature".to_string()),
        };
    }

    let message = anchor_sign_bytes(
        &receipt.layer_id,
        receipt.layer_height,
        &receipt.state_root,
        &receipt.validator_set_hash,
    );

    let public_key = match hex_to_bytes(&public_key_hex) {
        Ok(b) => b,
        Err(e) => {
            return ReceiptVerification {
                valid: false,
                checks,
                reason: Some(format!("signature check failed: {e}")),
            };
        }
    };
    let signature = match hex_to_bytes(&receipt.pqc_signature) {
        Ok(b) => b,
        Err(e) => {
            return ReceiptVerification {
                valid: false,
                checks,
                reason: Some(format!("signature check failed: {e}")),
            };
        }
    };

    checks.pqc_signature =
        qorechain_pqc::mldsa::ml_dsa_87::verify(&public_key, &message, &signature);

    let valid = checks.state_root_binding && checks.pqc_signature;
    let reason = if valid {
        None
    } else if !checks.state_root_binding {
        Some("batch state root does not match the anchored state root".to_string())
    } else {
        Some("Dilithium-5 anchor signature did not verify".to_string())
    };

    ReceiptVerification {
        valid,
        checks,
        reason,
    }
}
