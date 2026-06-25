//! Withdrawal-proof assembly for `MsgExecuteWithdrawal`.

use super::merkle::{binary_merkle_proof, MerkleOptions};
use crate::tx::messages::ExecuteWithdrawalInput;

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
/// full list of the batch's withdrawal leaves.
pub fn assemble_withdrawal_proof(
    leaves: &[Vec<u8>],
    withdrawal_index: usize,
    options: MerkleOptions,
) -> WithdrawalProof {
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
