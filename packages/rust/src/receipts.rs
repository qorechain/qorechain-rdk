//! Quantum-Safe Settlement Receipts.
//!
//! A settlement receipt is a portable record that a rollup's settlement batch
//! was anchored to the QoreChain Main Chain under a post-quantum
//! (ML-DSA-87 / Dilithium-5) signature.
//!
//! A receipt is a **claim, not evidence** — every field in it is supplied by
//! whoever hands it to you. [`verify_settlement_receipt`] therefore re-reads the
//! claim from live chain state (the rollup's layer, the batch's state root, the
//! anchor, and the creator's registered key) and only then reports it valid.
//! Checking the signature alone, against a key you were handed, proves that
//! someone signed those bytes — not that QoreChain anchored anything. There is
//! no offline verification of a settlement receipt.
//!
//! Canonical anchor message (matches the chain's `anchorSignBytes`):
//! `layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash`.

use serde::{Deserialize, Serialize};

use crate::client::facade::RdkClient;
use crate::client::views::AnchorView;
use crate::utils::bytes::{bytes_to_hex, decode_wire_bytes, hex_to_bytes};

/// The post-quantum algorithm the anchor signature uses.
pub const RECEIPT_ALGORITHM: &str = "ML-DSA-87";

/// Current receipt schema version.
pub const RECEIPT_VERSION: u32 = 2;

/// Domain tag of the v2 anchor sign bytes (chain v3.2.2 and above).
pub const ANCHOR_SIGN_DOMAIN_V2: &str = "qorechain-multilayer-anchor-v2";

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

/// A portable settlement receipt. Verify it with [`verify_settlement_receipt`],
/// which re-reads every field from live chain state — the receipt on its own is
/// a claim, not evidence.
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
    /// The state root read from the settlement batch (hex) when the receipt was
    /// built. **Informational only** — verification compares the receipt against
    /// the chain's batch, never against this copy of it.
    pub batch_state_root: String,
    /// The chain the receipt was built on (e.g. `qorechain-vladi`). Bound into
    /// the v2 anchor signature and cross-checked against the node being
    /// queried. Absent on version-1 receipts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chain_id: Option<String>,
    /// The anchor's transaction count, covered by the v2 signature. Carried so
    /// a receipt stays self-describing; verification uses the chain's copy.
    #[serde(default)]
    pub transaction_count: u64,
    /// The anchor's compressed state proof (hex), covered by the v2 signature.
    /// Empty for a settlement batch. Verification uses the chain's copy.
    #[serde(default)]
    pub compressed_state_proof: String,
}

/// How a receipt was checked.
///
/// - [`ReceiptVerificationMode::Chain`] — every field was reproduced from live
///   chain state. Only this mode can yield `valid: true`.
/// - [`ReceiptVerificationMode::SignatureOnly`] — the ML-DSA-87 signature was
///   checked against a key the caller supplied. That proves whoever holds that
///   key signed these bytes; it does **not** prove the anchor exists on
///   QoreChain. Always `valid: false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReceiptVerificationMode {
    /// Verified against live chain state.
    Chain,
    /// Only the signature was checked, against a caller-supplied key.
    SignatureOnly,
}

/// The individual checks of a receipt verification.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptChecks {
    /// The chain says `rollup_id` belongs to the receipt's `layer_id`.
    pub rollup_layer_binding: bool,
    /// The chain's batch carries the receipt's state root.
    pub batch_state_root: bool,
    /// An anchor with this state root, height and signature exists on chain.
    pub anchor_on_chain: bool,
    /// The signing key was resolved from chain, not taken from the receipt.
    pub creator_authority: bool,
    /// The Dilithium-5 signature over the canonical message verified.
    pub pqc_signature: bool,
    /// The receipt names the chain that was actually queried. A version-1
    /// receipt carries no chain id and passes on the strength of the anchor
    /// having been found on this chain.
    pub chain_binding: bool,
}

/// The outcome of verifying a receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptVerification {
    /// True only when the receipt was reproduced from live chain state.
    pub valid: bool,
    /// Which check was actually performed.
    pub mode: ReceiptVerificationMode,
    /// The individual checks.
    pub checks: ReceiptChecks,
    /// Which canonical anchor message the signature was checked against:
    /// `v2` from the chain's `rdk-integrity` height, `v1` below it.
    pub sign_bytes_version: Option<AnchorSignBytesVersion>,
    /// A human-readable reason when invalid.
    pub reason: Option<String>,
}

/// Which canonical anchor message a signature covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorSignBytesVersion {
    /// The pre-v3.2.2 message.
    V1,
    /// The v3.2.2 and later message.
    V2,
}

/// The **pre-v3.2.2** canonical anchor message:
/// `layer_id || layer_height(8B BE) || state_root || validator_set_hash`.
///
/// Kept because anchors written before the chain's `rdk-integrity` switch are
/// signed this way and stay valid forever. Do not use it for new work: it has no
/// length prefixes, so field boundaries are ambiguous, and no chain id, so a
/// signature is valid on **every** chain. Both are why v2 exists.
pub fn anchor_sign_bytes_v1(
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

/// The v1 canonical anchor message, kept for backwards compatibility. New code
/// should call [`anchor_sign_bytes_v1`] or [`anchor_sign_bytes_v2`] explicitly.
pub fn anchor_sign_bytes(
    layer_id: &str,
    layer_height: u64,
    state_root_hex: &str,
    vsh_hex: &str,
) -> Vec<u8> {
    anchor_sign_bytes_v1(layer_id, layer_height, state_root_hex, vsh_hex)
}

/// The **v3.2.2 and later** canonical anchor message. Every variable-length
/// field carries an 8-byte big-endian length, the chain id binds the signature
/// to one network, and the transaction count and compressed state proof are
/// covered too, because the chain computes its anchor fraud check from them:
///
/// ```text
/// "qorechain-multilayer-anchor-v2"
///  | BE64 len(chain_id)               chain_id
///  | BE64 len(layer_id)               layer_id
///  | BE64                             layer_height
///  | BE64 len(state_root)             state_root
///  | BE64 len(validator_set_hash)     validator_set_hash
///  | BE64                             transaction_count
///  | BE64 len(compressed_state_proof) compressed_state_proof
/// ```
///
/// For a settlement batch the chain maps these as: `layer_id` is the rollup's
/// layer id, `layer_height` is the **batch index**, `state_root` the batch state
/// root, `transaction_count` the batch's transaction count, and the compressed
/// state proof empty.
pub fn anchor_sign_bytes_v2(
    chain_id: &str,
    layer_id: &str,
    layer_height: u64,
    state_root_hex: &str,
    vsh_hex: &str,
    transaction_count: u64,
    compressed_state_proof_hex: &str,
) -> Vec<u8> {
    let state_root = hex_to_bytes(state_root_hex).unwrap_or_default();
    let vsh = hex_to_bytes(vsh_hex).unwrap_or_default();
    let proof = hex_to_bytes(compressed_state_proof_hex).unwrap_or_default();
    let mut out = Vec::new();
    out.extend_from_slice(ANCHOR_SIGN_DOMAIN_V2.as_bytes());
    let put = |b: &[u8], out: &mut Vec<u8>| {
        out.extend_from_slice(&(b.len() as u64).to_be_bytes());
        out.extend_from_slice(b);
    };
    put(chain_id.as_bytes(), &mut out);
    put(layer_id.as_bytes(), &mut out);
    out.extend_from_slice(&layer_height.to_be_bytes());
    put(&state_root, &mut out);
    put(&vsh, &mut out);
    out.extend_from_slice(&transaction_count.to_be_bytes());
    put(&proof, &mut out);
    out
}

/// Which anchor message a given anchor was signed over: the form in force at
/// the Main Chain height it was recorded at.
///
/// Deciding by height rather than trying both forms matters. A v1 signature
/// covers no chain id, so it is valid on every chain; accepting v1 where v2 is
/// in force would re-admit exactly the weakness v2 was introduced to close.
pub fn anchor_sign_bytes_version_for(
    anchor_main_chain_height: i64,
    v2_height: u64,
) -> AnchorSignBytesVersion {
    if anchor_main_chain_height >= 0 && anchor_main_chain_height as u64 >= v2_height {
        AnchorSignBytesVersion::V2
    } else {
        AnchorSignBytesVersion::V1
    }
}

fn receipt_from_parts(
    rollup_id: &str,
    layer_id: &str,
    batch_index: u64,
    creator: &str,
    anchor: &AnchorView,
    batch_state_root_hex: &str,
    chain_id: &str,
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
        chain_id: Some(chain_id.to_string()),
        transaction_count: anchor.transaction_count.max(0) as u64,
        compressed_state_proof: anchor.compressed_state_proof.clone(),
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
        bytes_to_hex(&decode_wire_bytes(&batch.state_root))
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
        &client.network.chain_id,
    ))
}

/// Verify an anchor's post-quantum signature. Every signed field is taken from
/// the chain's anchor, never from the receipt — the receipt only says which
/// anchor to go and look for. `chain_id` likewise comes from the network being
/// queried.
fn signature_over(
    anchor: &AnchorView,
    public_key_hex: &str,
    chain_id: &str,
    version: AnchorSignBytesVersion,
) -> bool {
    if public_key_hex.is_empty() || anchor.pqc_signature.is_empty() {
        return false;
    }
    let (Ok(public_key), Ok(signature)) = (
        hex_to_bytes(public_key_hex),
        hex_to_bytes(&anchor.pqc_signature),
    ) else {
        return false;
    };
    let message = match version {
        AnchorSignBytesVersion::V2 => anchor_sign_bytes_v2(
            chain_id,
            &anchor.layer_id,
            anchor.layer_height,
            &anchor.state_root,
            &anchor.validator_set_hash,
            anchor.transaction_count.max(0) as u64,
            &anchor.compressed_state_proof,
        ),
        AnchorSignBytesVersion::V1 => anchor_sign_bytes_v1(
            &anchor.layer_id,
            anchor.layer_height,
            &anchor.state_root,
            &anchor.validator_set_hash,
        ),
    };
    qorechain_pqc::mldsa::ml_dsa_87::verify(&public_key, &message, &signature)
}

/// The receipt's own copies of the signed fields, for signature-only mode where
/// there is no chain to read.
fn receipt_as_anchor(receipt: &SettlementReceipt) -> AnchorView {
    AnchorView {
        layer_id: receipt.layer_id.clone(),
        layer_height: receipt.layer_height,
        state_root: receipt.state_root.clone(),
        validator_set_hash: receipt.validator_set_hash.clone(),
        main_chain_height: receipt.main_chain_height,
        anchored_at: receipt.anchored_at,
        pqc_signature: receipt.pqc_signature.clone(),
        transaction_count: receipt.transaction_count as i64,
        compressed_state_proof: receipt.compressed_state_proof.clone(),
    }
}

/// Verify a settlement receipt against live chain state.
///
/// A receipt is a *claim*, not evidence: every field in it is supplied by
/// whoever hands it to you. Verification therefore re-reads the claim from the
/// chain — the rollup's layer, the batch's state root, the anchor itself, and
/// the signing key — and reports `valid: true` only when the receipt reproduces
/// what the chain actually holds. Pass `client` for this.
///
/// Without a `client` you can still check the signature against a
/// `creator_public_key_hex` you obtained out of band, but that is
/// [`ReceiptVerificationMode::SignatureOnly`] and never `valid`: a signature
/// proves someone signed these bytes, not that the anchor exists. When `client`
/// is supplied, `creator_public_key_hex` is ignored — the key is resolved from
/// chain.
pub fn verify_settlement_receipt(
    receipt: &SettlementReceipt,
    creator_public_key_hex: Option<&str>,
    client: Option<&RdkClient>,
) -> ReceiptVerification {
    let mut checks = ReceiptChecks::default();

    let Some(client) = client else {
        let Some(public_key_hex) = creator_public_key_hex else {
            return ReceiptVerification {
                valid: false,
                mode: ReceiptVerificationMode::SignatureOnly,
                checks,
                sign_bytes_version: None,
                reason: Some(
                    "no client supplied — pass a client to verify against chain state; a receipt on its own proves nothing"
                        .to_string(),
                ),
            };
        };
        // Without a client there is no chain to read, so the receipt's own
        // copies are all there is — which is why this mode is never valid. Both
        // forms are tried because nothing here reveals the anchor's height.
        let as_anchor = receipt_as_anchor(receipt);
        let mut version = None;
        if let Some(chain_id) = receipt.chain_id.as_deref() {
            if signature_over(
                &as_anchor,
                public_key_hex,
                chain_id,
                AnchorSignBytesVersion::V2,
            ) {
                checks.pqc_signature = true;
                version = Some(AnchorSignBytesVersion::V2);
            }
        }
        if !checks.pqc_signature
            && signature_over(&as_anchor, public_key_hex, "", AnchorSignBytesVersion::V1)
        {
            checks.pqc_signature = true;
            version = Some(AnchorSignBytesVersion::V1);
        }
        let reason = if checks.pqc_signature {
            "signature is valid for the supplied key, but nothing was checked against the chain — pass a client to verify settlement"
        } else {
            "signature did not verify against the supplied key"
        };
        return ReceiptVerification {
            valid: false,
            mode: ReceiptVerificationMode::SignatureOnly,
            checks,
            sign_bytes_version: version,
            reason: Some(reason.to_string()),
        };
    };

    let fail = |checks: ReceiptChecks, reason: String| ReceiptVerification {
        valid: false,
        mode: ReceiptVerificationMode::Chain,
        checks,
        sign_bytes_version: None,
        reason: Some(reason),
    };

    // 1. The rollup must exist on chain and belong to the layer the receipt names.
    let rollup = match client.rest.get_rollup(&receipt.rollup_id) {
        Ok(r) => r,
        Err(e) => {
            return fail(
                checks,
                format!("rollup \"{}\" not found on chain: {e}", receipt.rollup_id),
            );
        }
    };
    checks.rollup_layer_binding =
        !rollup.layer_id.is_empty() && rollup.layer_id == receipt.layer_id;
    if !checks.rollup_layer_binding {
        let on_chain = if rollup.layer_id.is_empty() {
            "(none)"
        } else {
            rollup.layer_id.as_str()
        };
        return fail(
            checks,
            format!(
                "rollup \"{}\" is anchored to layer \"{on_chain}\", not \"{}\"",
                receipt.rollup_id, receipt.layer_id
            ),
        );
    }

    // 2. The chain's batch must carry the receipt's state root (not the receipt's own copy).
    let batch = match client
        .rest
        .get_batch(&receipt.rollup_id, receipt.batch_index)
    {
        Ok(b) => b,
        Err(e) => {
            return fail(
                checks,
                format!("batch {} not found on chain: {e}", receipt.batch_index),
            );
        }
    };
    let on_chain_root = if batch.state_root.is_empty() {
        String::new()
    } else {
        bytes_to_hex(&decode_wire_bytes(&batch.state_root))
    };
    checks.batch_state_root = !on_chain_root.is_empty() && on_chain_root == receipt.state_root;
    if !checks.batch_state_root {
        return fail(
            checks,
            "the chain's batch does not carry the receipt's state root".to_string(),
        );
    }

    // 3. An anchor matching this receipt must actually exist on chain.
    let anchors = match client.rest.get_anchors(&receipt.layer_id) {
        Ok(a) => a,
        Err(e) => {
            return fail(
                checks,
                format!(
                    "could not read anchors for layer \"{}\": {e}",
                    receipt.layer_id
                ),
            );
        }
    };
    // The matched anchor is kept: it, not the receipt, is what step 6 verifies.
    let matched = anchors.iter().find(|a| {
        a.state_root == receipt.state_root
            && a.layer_height == receipt.layer_height
            && a.validator_set_hash == receipt.validator_set_hash
            && a.pqc_signature == receipt.pqc_signature
    });
    checks.anchor_on_chain = matched.is_some();
    let Some(matched) = matched else {
        return fail(
            checks,
            "no anchor on chain matches this receipt — it is fabricated or superseded".to_string(),
        );
    };

    // 4. The signing key is resolved from the chain, never taken from the receipt.
    let public_key_hex = match client.rest.get_pqc_account(&rollup.creator) {
        Ok(account) => account.public_key,
        Err(e) => {
            return fail(
                checks,
                format!("could not resolve the creator's post-quantum key: {e}"),
            );
        }
    };
    if receipt.creator != rollup.creator {
        return fail(
            checks,
            format!(
                "receipt names creator \"{}\" but the chain says the rollup's creator is \"{}\"",
                receipt.creator, rollup.creator
            ),
        );
    }
    checks.creator_authority = !public_key_hex.is_empty();
    if !checks.creator_authority {
        return fail(
            checks,
            format!(
                "no post-quantum key is registered for creator {}",
                rollup.creator
            ),
        );
    }

    // 5. The receipt must name the chain we actually queried. A version-1
    // receipt carries no chain id; it still verifies, because step 3 already
    // required the anchor to exist on this chain, but the binding is the chain
    // read rather than the receipt's own word.
    let chain_id = client.network.chain_id.as_str();
    if let Some(claimed) = receipt.chain_id.as_deref() {
        if claimed != chain_id {
            return fail(
                checks,
                format!(
                    "receipt is for chain \"{claimed}\" but this client is connected to \"{chain_id}\" — verify it against a node for its own network"
                ),
            );
        }
    }
    checks.chain_binding = true;

    // 6. Finally the post-quantum signature, over the form the chain had in
    // force at the height this anchor was recorded at.
    let version = anchor_sign_bytes_version_for(
        matched.main_chain_height,
        client.network.anchor_sign_v2_height,
    );
    checks.pqc_signature = signature_over(matched, &public_key_hex, chain_id, version);
    if !checks.pqc_signature {
        let label = match version {
            AnchorSignBytesVersion::V1 => "v1",
            AnchorSignBytesVersion::V2 => "v2",
        };
        return ReceiptVerification {
            valid: false,
            mode: ReceiptVerificationMode::Chain,
            checks,
            sign_bytes_version: Some(version),
            reason: Some(format!(
                "Dilithium-5 anchor signature did not verify against the creator's registered key (checked as {label}, for an anchor at height {})",
                matched.main_chain_height
            )),
        };
    }

    ReceiptVerification {
        valid: true,
        mode: ReceiptVerificationMode::Chain,
        checks,
        sign_bytes_version: Some(version),
        reason: None,
    }
}
