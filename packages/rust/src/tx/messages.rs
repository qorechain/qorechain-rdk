//! Friendly input structs that turn RDK-shaped inputs into the protobuf codec
//! messages (and `cosmrs::Any`) ready to sign and broadcast.

use cosmrs::Any;

use super::codecs::{
    MsgChallengeBatch, MsgCreateRollup, MsgExecuteWithdrawal, MsgPauseRollup, MsgResolveChallenge,
    MsgResumeRollup, MsgStopRollup, MsgSubmitBatch, RdkMsg,
};

/// Wrap a typed `rdk` message as a `cosmrs::Any` with its type URL.
pub fn to_any<M: RdkMsg>(msg: &M) -> Any {
    Any {
        type_url: M::type_url(),
        value: msg.encode_to_vec_msg(),
    }
}

/// Inputs for `MsgCreateRollup`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRollupInput {
    /// Creator address.
    pub creator: String,
    /// Unique rollup id.
    pub rollup_id: String,
    /// Preset profile (wire string).
    pub profile: String,
    /// Execution environment (wire string).
    pub vm_type: String,
    /// Stake committed at creation, in uqor.
    pub stake_amount: i64,
}

impl CreateRollupInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgCreateRollup {
        MsgCreateRollup {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
            profile: self.profile.clone(),
            vm_type: self.vm_type.clone(),
            stake_amount: self.stake_amount,
        }
    }
}

/// Inputs for `MsgSubmitBatch`. Byte fields default to empty when `None`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SubmitBatchInput {
    /// Sequencer address.
    pub sequencer: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Batch index.
    pub batch_index: u64,
    /// Post-state root.
    pub state_root: Vec<u8>,
    /// Previous-state root.
    pub prev_state_root: Vec<u8>,
    /// Transaction count.
    pub tx_count: u64,
    /// Data-availability hash.
    pub data_hash: Vec<u8>,
    /// Settlement proof.
    pub proof: Vec<u8>,
    /// Withdrawals Merkle root.
    pub withdrawals_root: Vec<u8>,
}

impl SubmitBatchInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgSubmitBatch {
        MsgSubmitBatch {
            sequencer: self.sequencer.clone(),
            rollup_id: self.rollup_id.clone(),
            batch_index: self.batch_index,
            state_root: self.state_root.clone(),
            prev_state_root: self.prev_state_root.clone(),
            tx_count: self.tx_count,
            data_hash: self.data_hash.clone(),
            proof: self.proof.clone(),
            withdrawals_root: self.withdrawals_root.clone(),
        }
    }
}

/// Inputs for `MsgChallengeBatch`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChallengeBatchInput {
    /// Challenger address.
    pub challenger: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Batch index.
    pub batch_index: u64,
    /// Fraud proof.
    pub proof: Vec<u8>,
}

impl ChallengeBatchInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgChallengeBatch {
        MsgChallengeBatch {
            challenger: self.challenger.clone(),
            rollup_id: self.rollup_id.clone(),
            batch_index: self.batch_index,
            proof: self.proof.clone(),
        }
    }
}

/// Inputs for `MsgResolveChallenge`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolveChallengeInput {
    /// Resolver address.
    pub resolver: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Batch index.
    pub batch_index: u64,
    /// Whether fraud was upheld.
    pub fraud_upheld: bool,
}

impl ResolveChallengeInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgResolveChallenge {
        MsgResolveChallenge {
            resolver: self.resolver.clone(),
            rollup_id: self.rollup_id.clone(),
            batch_index: self.batch_index,
            fraud_upheld: self.fraud_upheld,
        }
    }
}

/// Inputs for `MsgPauseRollup`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PauseRollupInput {
    /// Creator address.
    pub creator: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Optional reason.
    pub reason: String,
}

impl PauseRollupInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgPauseRollup {
        MsgPauseRollup {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
            reason: self.reason.clone(),
        }
    }
}

/// Inputs for a rollup reference (resume / stop).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RollupRefInput {
    /// Creator address.
    pub creator: String,
    /// Target rollup id.
    pub rollup_id: String,
}

impl RollupRefInput {
    /// Build a `MsgResumeRollup`.
    pub fn to_resume_msg(&self) -> MsgResumeRollup {
        MsgResumeRollup {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
        }
    }

    /// Build a `MsgStopRollup`.
    pub fn to_stop_msg(&self) -> MsgStopRollup {
        MsgStopRollup {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
        }
    }
}

/// Inputs for `MsgExecuteWithdrawal`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExecuteWithdrawalInput {
    /// Submitter address.
    pub submitter: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Finalized batch index.
    pub batch_index: u64,
    /// Withdrawal index within the batch.
    pub withdrawal_index: u64,
    /// The committed recipient.
    pub recipient: String,
    /// The withdrawal denom.
    pub denom: String,
    /// The withdrawal amount.
    pub amount: i64,
    /// Sibling hashes from the leaf to `withdrawals_root`.
    pub proof: Vec<Vec<u8>>,
}

impl ExecuteWithdrawalInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgExecuteWithdrawal {
        MsgExecuteWithdrawal {
            submitter: self.submitter.clone(),
            rollup_id: self.rollup_id.clone(),
            batch_index: self.batch_index,
            withdrawal_index: self.withdrawal_index,
            recipient: self.recipient.clone(),
            denom: self.denom.clone(),
            amount: self.amount,
            proof: self.proof.clone(),
        }
    }
}
