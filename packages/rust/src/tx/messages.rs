//! Friendly input structs that turn RDK-shaped inputs into the protobuf codec
//! messages (and `cosmrs::Any`) ready to sign and broadcast.

use cosmrs::Any;

use crate::config::vm_type_wire_value;

use super::codecs::{
    MsgBondRollupSubmitter, MsgChallengeBatch, MsgCreateRollup, MsgDepositToRollup,
    MsgExecuteWithdrawal, MsgPauseRollup, MsgPostRollupData, MsgRegisterKemKey,
    MsgResolveChallenge, MsgResumeRollup, MsgSetRollupMembers, MsgSetRollupSequencing,
    MsgSetVerificationKey, MsgStopRollup, MsgSubmitBatch, MsgUnbondRollupSubmitter,
    MsgUpdateVerificationKey, RdkMsg,
};

/// Wrap a typed `rdk` message as a `cosmrs::Any` with its type URL.
pub fn to_any<M: RdkMsg>(msg: &M) -> Any {
    Any {
        type_url: M::type_url(),
        value: msg.encode_to_vec_msg(),
    }
}

/// Inputs for `MsgCreateRollup`. The chain v3.2.7/v3.2.8 fields default to
/// empty (not sent).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
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
    /// Chain v3.2.7+: register the zk verification key at creation (see
    /// [`SetVerificationKeyInput`]).
    pub verification_key: Vec<u8>,
    /// Chain v3.2.8+: `"based"` orders the rollup's transactions by their
    /// inclusion on the chain (anyone posts, every batch consumes the inbox).
    /// Allowed for zk (snark), based settlement, and qledger-v1 optimistic
    /// rollups.
    pub sequencing: String,
    /// Chain v3.2.8+: `"qledger-v1"`, the execution model the chain
    /// re-executes in a fraud proof. **Required for every new optimistic
    /// rollup** (`nft`, `custom`), together with `sequencing: "based"`.
    pub execution_vm: String,
    /// Chain v3.2.8+: `"encapsulated"` for a private rollup (zk with a Groth16
    /// key only).
    pub privacy: String,
}

impl CreateRollupInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgCreateRollup {
        MsgCreateRollup {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
            profile: self.profile.clone(),
            // The QoreChain Native runtime (`native`) is transmitted as
            // `cosmwasm`; every other value passes through unchanged.
            vm_type: vm_type_wire_value(&self.vm_type).to_string(),
            stake_amount: self.stake_amount,
            verification_key: self.verification_key.clone(),
            sequencing: self.sequencing.clone(),
            execution_vm: self.execution_vm.clone(),
            privacy: self.privacy.clone(),
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
    /// Chain v3.2.8+, based rollups only: the inbox sequence of the last post
    /// this batch consumes. `data_hash` must then be the inbox range
    /// commitment ([`crate::inbox::inbox_range_hash`], or
    /// `RestClient::get_inbox(rollup_id, inbox_end)`). Zero otherwise.
    pub inbox_end: u64,
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
            inbox_end: self.inbox_end,
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

// --- chain v3.2.7+ -----------------------------------------------------------

/// Inputs for `MsgSetVerificationKey`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetVerificationKeyInput {
    /// Creator address.
    pub creator: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Groth16 BLS12-381 verifying key, gnark binary encoding, four public
    /// inputs.
    pub verification_key: Vec<u8>,
    /// `"snark"`; empty keeps the rollup's proof system. `"stark"` is refused
    /// from v3.2.8.
    pub proof_system: String,
}

impl SetVerificationKeyInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgSetVerificationKey {
        MsgSetVerificationKey {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
            verification_key: self.verification_key.clone(),
            proof_system: self.proof_system.clone(),
        }
    }
}

/// Inputs for `MsgUpdateVerificationKey`. Governance only: put the message in
/// a proposal; `authority` is the gov module account.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UpdateVerificationKeyInput {
    /// The gov module account.
    pub authority: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// The verification key.
    pub verification_key: Vec<u8>,
    /// The proof system the key is for.
    pub proof_system: String,
}

impl UpdateVerificationKeyInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgUpdateVerificationKey {
        MsgUpdateVerificationKey {
            authority: self.authority.clone(),
            rollup_id: self.rollup_id.clone(),
            verification_key: self.verification_key.clone(),
            proof_system: self.proof_system.clone(),
        }
    }
}

// --- chain v3.2.8+ -----------------------------------------------------------

/// Inputs for `MsgPostRollupData`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PostRollupDataInput {
    /// Poster address.
    pub poster: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// The payload (an envelope on a private rollup).
    pub data: Vec<u8>,
}

impl PostRollupDataInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgPostRollupData {
        MsgPostRollupData {
            poster: self.poster.clone(),
            rollup_id: self.rollup_id.clone(),
            data: self.data.clone(),
        }
    }
}

/// Inputs for `MsgSetRollupSequencing`. Governance only: `sequencing` is
/// `"based"` or `""`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetRollupSequencingInput {
    /// The gov module account.
    pub authority: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// `"based"` or `""`.
    pub sequencing: String,
}

impl SetRollupSequencingInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgSetRollupSequencing {
        MsgSetRollupSequencing {
            authority: self.authority.clone(),
            rollup_id: self.rollup_id.clone(),
            sequencing: self.sequencing.clone(),
        }
    }
}

/// Inputs for `MsgDepositToRollup`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DepositToRollupInput {
    /// Depositor address.
    pub depositor: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// The 32-byte qledger-v1 account id to credit.
    pub account: Vec<u8>,
    /// Amount, in uqor.
    pub amount: u64,
}

impl DepositToRollupInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgDepositToRollup {
        MsgDepositToRollup {
            depositor: self.depositor.clone(),
            rollup_id: self.rollup_id.clone(),
            account: self.account.clone(),
            amount: self.amount,
        }
    }
}

/// Inputs for `MsgBondRollupSubmitter`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BondRollupSubmitterInput {
    /// Submitter address.
    pub submitter: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// Amount, in uqor.
    pub amount: u64,
}

impl BondRollupSubmitterInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgBondRollupSubmitter {
        MsgBondRollupSubmitter {
            submitter: self.submitter.clone(),
            rollup_id: self.rollup_id.clone(),
            amount: self.amount,
        }
    }
}

/// Inputs for `MsgUnbondRollupSubmitter`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UnbondRollupSubmitterInput {
    /// Submitter address.
    pub submitter: String,
    /// Target rollup id.
    pub rollup_id: String,
}

impl UnbondRollupSubmitterInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgUnbondRollupSubmitter {
        MsgUnbondRollupSubmitter {
            submitter: self.submitter.clone(),
            rollup_id: self.rollup_id.clone(),
        }
    }
}

/// Inputs for `MsgSetRollupMembers`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetRollupMembersInput {
    /// Creator address.
    pub creator: String,
    /// Target rollup id.
    pub rollup_id: String,
    /// The members, in envelope order.
    pub members: Vec<String>,
}

impl SetRollupMembersInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgSetRollupMembers {
        MsgSetRollupMembers {
            creator: self.creator.clone(),
            rollup_id: self.rollup_id.clone(),
            members: self.members.clone(),
        }
    }
}

/// ML-KEM-1024's id in the chain's algorithm registry.
pub const ML_KEM_1024_ALGORITHM_ID: u32 = 2;

/// Inputs for `MsgRegisterKEMKey` (the `pqc` module's KEM registry).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterKemKeyInput {
    /// Sender address.
    pub sender: String,
    /// The algorithm id; [`ML_KEM_1024_ALGORITHM_ID`] by default.
    pub algorithm_id: u32,
    /// The encapsulation (public) key; 1568 bytes for ML-KEM-1024.
    pub public_key: Vec<u8>,
}

impl Default for RegisterKemKeyInput {
    fn default() -> Self {
        RegisterKemKeyInput {
            sender: String::new(),
            algorithm_id: ML_KEM_1024_ALGORITHM_ID,
            public_key: Vec::new(),
        }
    }
}

impl RegisterKemKeyInput {
    /// Build the protobuf message.
    pub fn to_msg(&self) -> MsgRegisterKemKey {
        MsgRegisterKemKey {
            sender: self.sender.clone(),
            algorithm_id: self.algorithm_id,
            public_key: self.public_key.clone(),
        }
    }
}
