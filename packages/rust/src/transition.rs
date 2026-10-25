//! The canonical batch transition root: the state root a protocol-following
//! sequencer publishes for a settlement batch.
//!
//! The chain judges an optimistic batch by it. A fraud challenge is upheld when
//! the batch's published `state_root` differs from this root and the
//! challenger names this root (see [`fraud_proof`]); from chain v3.2.5 any
//! account may resolve that challenge, and an upheld one is paid from the
//! rollup's escrow. A batch that publishes anything else, such as a
//! placeholder, is provably fraudulent. The test vectors come from the chain's
//! own `BatchTransitionRoot`.

use crate::client::rest::{RestClient, RestError};
use crate::client::views::BatchView;

/// The protocol feature that switches batches to the v2 binding.
pub const FEATURE_RDK_WITHDRAWALS_BINDING: &str = "rdk-withdrawals-binding";
/// The chain upgrade that turns it on.
pub const WITHDRAWALS_BINDING_UPGRADE: &str = "v3.2.5";

/// Which transition binding a batch is judged by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionRootVersion {
    /// The original binding.
    V1,
    /// Chain v3.2.5, `rdk-withdrawals-binding`.
    V2,
}

/// What the transition binding covers. `chain_id`, `rollup_id` and
/// `withdrawals_root` are used by v2 only.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TransitionInput {
    /// The network the batch is submitted to (v2).
    pub chain_id: String,
    /// The rollup id (v2).
    pub rollup_id: String,
    /// The state root the batch starts from.
    pub prev_state_root: Vec<u8>,
    /// The batch's data hash; empty on a native-DA rollup.
    pub data_hash: Vec<u8>,
    /// The batch's transaction count.
    pub tx_count: u64,
    /// The withdrawals Merkle root, empty or 32 bytes (v2).
    pub withdrawals_root: Vec<u8>,
}

fn field(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as u32).to_be_bytes());
    out.extend_from_slice(b);
}

/// The original binding, used for every batch before the chain's
/// `rdk-withdrawals-binding` switch:
/// `SHAKE-256(prev_state_root || data_hash || tx_count(8B BE))`, 32 bytes.
pub fn batch_transition_root_v1(input: &TransitionInput) -> [u8; 32] {
    let mut msg = Vec::new();
    msg.extend_from_slice(&input.prev_state_root);
    msg.extend_from_slice(&input.data_hash);
    msg.extend_from_slice(&input.tx_count.to_be_bytes());
    qorechain_pqc::shake256(&msg)
}

/// The v2 binding (chain v3.2.5, `rdk-withdrawals-binding`), which also covers
/// the chain id, the rollup id and the withdrawals root. Every variable-length
/// field carries a 4-byte big-endian length prefix.
pub fn batch_transition_root_v2(input: &TransitionInput) -> Result<[u8; 32], String> {
    if input.chain_id.is_empty() || input.rollup_id.is_empty() {
        return Err(
            "the v2 transition root covers the chain id and the rollup id; pass both".into(),
        );
    }
    let n = input.withdrawals_root.len();
    if n != 0 && n != 32 {
        return Err(format!(
            "withdrawals root must be empty or 32 bytes, got {n}"
        ));
    }
    let mut msg = Vec::new();
    field(&mut msg, b"qorechain-rdk-transition/v2");
    field(&mut msg, input.chain_id.as_bytes());
    field(&mut msg, input.rollup_id.as_bytes());
    field(&mut msg, &input.prev_state_root);
    field(&mut msg, &input.data_hash);
    msg.extend_from_slice(&input.tx_count.to_be_bytes());
    field(&mut msg, &input.withdrawals_root);
    Ok(qorechain_pqc::shake256(&msg))
}

/// The transition root under `version`.
pub fn batch_transition_root(
    input: &TransitionInput,
    version: TransitionRootVersion,
) -> Result<[u8; 32], String> {
    match version {
        TransitionRootVersion::V1 => Ok(batch_transition_root_v1(input)),
        TransitionRootVersion::V2 => batch_transition_root_v2(input),
    }
}

/// Which binding a batch submitted now is judged by: v2 once the chain reports
/// `rdk-withdrawals-binding` enabled, v1 before. A batch keeps the binding it
/// was submitted under, so compute the root right before submitting.
pub fn transition_root_version_for(rest: &RestClient) -> Result<TransitionRootVersion, RestError> {
    Ok(
        if rest.is_protocol_feature_enabled(FEATURE_RDK_WITHDRAWALS_BINDING)? {
            TransitionRootVersion::V2
        } else {
            TransitionRootVersion::V1
        },
    )
}

/// Which binding the chain judges an existing batch by. The chain decides once,
/// at submission: a batch is bound to v2 exactly when it was included at or
/// above the height where [`WITHDRAWALS_BINDING_UPGRADE`] was applied (the
/// upgrade block itself included). The batch's own `withdrawals_bound` is used
/// when the node serves it. Challenge only with the root under this version: a
/// fraud proof built on the other binding is dismissed and its bond forfeited.
pub fn transition_root_version_for_batch(
    rest: &RestClient,
    batch: &BatchView,
) -> Result<TransitionRootVersion, RestError> {
    if batch.withdrawals_bound {
        return Ok(TransitionRootVersion::V2);
    }
    let applied = rest.get_applied_plan_height(WITHDRAWALS_BINDING_UPGRADE)?;
    Ok(if applied > 0 && batch.submitted_at >= applied {
        TransitionRootVersion::V2
    } else {
        TransitionRootVersion::V1
    })
}

/// The fraud proof the chain's optimistic verifier reads:
/// `prev_state_root(32) || correct_state_root(32)`.
pub fn fraud_proof(prev_state_root: &[u8], correct_state_root: &[u8]) -> Result<Vec<u8>, String> {
    if prev_state_root.len() != 32 || correct_state_root.len() != 32 {
        return Err(
            "a fraud proof needs a 32-byte previous root and a 32-byte correct root".into(),
        );
    }
    Ok([prev_state_root, correct_state_root].concat())
}
