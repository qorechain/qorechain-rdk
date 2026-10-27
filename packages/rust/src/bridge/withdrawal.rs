//! Withdrawal-proof assembly for `MsgExecuteWithdrawal`.
//!
//! A withdrawal is executed by proving its leaf is committed in a finalized
//! batch's `withdrawals_root`. This module turns the batch's withdrawal leaves
//! into the sibling-hash proof the message carries.
//!
//! Use [`withdrawals_tree`]: it builds the chain's own leaves and tree, so its
//! root and proofs are what `MsgExecuteWithdrawal` verifies (tested against the
//! chain's `VerifyWithdrawalMerkle`). The chain places each withdrawal at its
//! index, hashes nodes as SHAKE-256(left || right), and pairs an odd last node
//! with itself. A batch submitted from chain v3.2.5 (`rdk-withdrawals-binding`)
//! commits v2 leaves, which also name the chain id; check which with
//! [`crate::transition::transition_root_version_for_batch`].

use super::merkle::{binary_merkle_proof, binary_merkle_root, MerkleOptions};
use crate::transition::TransitionRootVersion;
use crate::tx::messages::ExecuteWithdrawalInput;
use crate::utils::qorehash::qorehash;

/// One L2 to L1 withdrawal as the chain hashes it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WithdrawalLeafInput {
    /// The rollup id.
    pub rollup_id: String,
    /// The withdrawal's position in its batch; also its leaf position.
    pub withdrawal_index: u64,
    /// The recipient address.
    pub recipient: String,
    /// The denomination.
    pub denom: String,
    /// The amount.
    pub amount: u64,
}

/// One withdrawal of a batch, before its rollup id and index are attached.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Withdrawal {
    /// The recipient address.
    pub recipient: String,
    /// The denomination.
    pub denom: String,
    /// The amount.
    pub amount: u64,
}

/// The chain's original withdrawal leaf (every batch before
/// `rdk-withdrawals-binding`): `SHAKE-256(rollup_id || 0x00 ||
/// withdrawal_index(8B BE) || recipient || 0x00 || denom || 0x00 ||
/// amount(8B BE))`.
pub fn withdrawal_leaf_v1(w: &WithdrawalLeafInput) -> [u8; 32] {
    qorehash(&[
        w.rollup_id.as_bytes(),
        &[0],
        &w.withdrawal_index.to_be_bytes(),
        w.recipient.as_bytes(),
        &[0],
        w.denom.as_bytes(),
        &[0],
        &w.amount.to_be_bytes(),
    ])
}

fn lp(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as u32).to_be_bytes());
    out.extend_from_slice(b);
}

/// The v2 leaf of a batch bound under chain v3.2.5: the same fields,
/// length-prefixed, behind a tag and the chain id, so a withdrawal committed
/// for one network has no valid proof on another.
pub fn withdrawal_leaf_v2(chain_id: &str, w: &WithdrawalLeafInput) -> Result<[u8; 32], String> {
    if chain_id.is_empty() {
        return Err("a v2 withdrawal leaf names the chain id; pass it".into());
    }
    let mut msg = Vec::new();
    lp(&mut msg, b"qorechain-rdk-withdrawal/v2");
    lp(&mut msg, chain_id.as_bytes());
    lp(&mut msg, w.rollup_id.as_bytes());
    msg.extend_from_slice(&w.withdrawal_index.to_be_bytes());
    lp(&mut msg, w.recipient.as_bytes());
    lp(&mut msg, w.denom.as_bytes());
    msg.extend_from_slice(&w.amount.to_be_bytes());
    Ok(qorehash(&[&msg]))
}

/// A batch's withdrawals, hashed and committed exactly as the chain does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WithdrawalsTree {
    /// The batch's `withdrawals_root` (32 bytes).
    pub root: Vec<u8>,
    /// The leaves, in withdrawal-index order.
    pub leaves: Vec<Vec<u8>>,
}

impl WithdrawalsTree {
    /// The proof for the withdrawal at `withdrawal_index`.
    ///
    /// # Panics
    ///
    /// Panics if `withdrawal_index` is out of range.
    pub fn proof(&self, withdrawal_index: usize) -> WithdrawalProof {
        assemble_withdrawal_proof(&self.leaves, withdrawal_index, None)
    }
}

/// Build a batch's withdrawals tree. Withdrawal `i` of `withdrawals` is
/// withdrawal index `i`. `version` must be the binding the chain judges the
/// batch by: [`TransitionRootVersion::V2`] (with `chain_id`) for a batch
/// submitted from chain v3.2.5's `rdk-withdrawals-binding`,
/// [`TransitionRootVersion::V1`] before; `chain_id` is unused by v1.
pub fn withdrawals_tree(
    withdrawals: &[Withdrawal],
    rollup_id: &str,
    version: TransitionRootVersion,
    chain_id: &str,
) -> Result<WithdrawalsTree, String> {
    if withdrawals.is_empty() {
        return Err("a withdrawals tree needs at least one withdrawal".into());
    }
    let leaves = withdrawals
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let input = WithdrawalLeafInput {
                rollup_id: rollup_id.to_string(),
                withdrawal_index: i as u64,
                recipient: w.recipient.clone(),
                denom: w.denom.clone(),
                amount: w.amount,
            };
            match version {
                TransitionRootVersion::V1 => Ok(withdrawal_leaf_v1(&input).to_vec()),
                TransitionRootVersion::V2 => withdrawal_leaf_v2(chain_id, &input).map(Vec::from),
            }
        })
        .collect::<Result<Vec<_>, String>>()?;
    let root = binary_merkle_root(&leaves, MerkleOptions::chain_tree());
    Ok(WithdrawalsTree { root, leaves })
}

/// The proof material for a single withdrawal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WithdrawalProof {
    /// Sibling hashes from the leaf to `withdrawals_root`, for the `proof` field.
    pub proof: Vec<Vec<u8>>,
    /// The computed `withdrawals_root` (compare against the batch's).
    pub withdrawals_root: Vec<u8>,
    /// The withdrawal's index within the batch.
    pub withdrawal_index: usize,
}

/// Assemble the Merkle proof for the withdrawal at `withdrawal_index` from the
/// full list of the batch's withdrawal leaves (from [`withdrawal_leaf_v1`] /
/// [`withdrawal_leaf_v2`]).
///
/// `None` uses the chain's tree, [`MerkleOptions::chain_tree`]. Before 0.7.0
/// the options were required and the usual ones re-hashed each leaf with
/// SHA-256, which the chain does not do; `MerkleOptions::default()` still
/// re-hashes each leaf (now with SHAKE-256), so it is not the chain's tree.
///
/// # Panics
///
/// Panics if `withdrawal_index` is out of range.
pub fn assemble_withdrawal_proof(
    leaves: &[Vec<u8>],
    withdrawal_index: usize,
    options: Option<MerkleOptions>,
) -> WithdrawalProof {
    let options = options.unwrap_or(MerkleOptions::chain_tree());
    let proof = binary_merkle_proof(leaves, withdrawal_index, options);
    WithdrawalProof {
        proof: proof.siblings,
        withdrawals_root: proof.root,
        withdrawal_index,
    }
}

/// Combine a withdrawal's recipient/amount details with an assembled proof into
/// the [`ExecuteWithdrawalInput`] for the tx client.
#[allow(clippy::too_many_arguments)]
pub fn build_execute_withdrawal_input(
    submitter: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    recipient: impl Into<String>,
    denom: impl Into<String>,
    amount: i64,
    withdrawal: &WithdrawalProof,
) -> ExecuteWithdrawalInput {
    ExecuteWithdrawalInput {
        submitter: submitter.into(),
        rollup_id: rollup_id.into(),
        batch_index,
        withdrawal_index: withdrawal.withdrawal_index as u64,
        recipient: recipient.into(),
        denom: denom.into(),
        amount,
        proof: withdrawal.proof.clone(),
    }
}
