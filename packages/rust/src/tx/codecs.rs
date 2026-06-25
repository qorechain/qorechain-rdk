//! Protobuf codecs for the `qorechain.rdk.v1` transaction messages, derived with
//! [`prost`].
//!
//! These mirror the on-chain `rdk` module's `tx.proto` exactly -- field numbers,
//! wire types, and message names. 64-bit integers use `i64`/`u64` matching the
//! proto (`int64` for amounts, `uint64` for indices/counts); `bytes` fields use
//! `Vec<u8>`. The type URLs follow the Cosmos `/package.Msg` convention.

use prost::Message;

/// The type-URL prefix for `rdk` messages.
pub const TYPE_URL_PREFIX: &str = "/qorechain.rdk.v1.";

/// `MsgCreateRollup` -- register a new rollup.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgCreateRollup {
    /// Creator (signer) address.
    #[prost(string, tag = "1")]
    pub creator: String,
    /// Unique rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Preset profile.
    #[prost(string, tag = "3")]
    pub profile: String,
    /// Execution environment.
    #[prost(string, tag = "4")]
    pub vm_type: String,
    /// Stake committed at creation, in uqor.
    #[prost(int64, tag = "5")]
    pub stake_amount: i64,
}

/// `MsgSubmitBatch` -- submit a settlement batch.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgSubmitBatch {
    /// Sequencer (signer) address.
    #[prost(string, tag = "1")]
    pub sequencer: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Batch index.
    #[prost(uint64, tag = "3")]
    pub batch_index: u64,
    /// Post-state root.
    #[prost(bytes = "vec", tag = "4")]
    pub state_root: Vec<u8>,
    /// Previous-state root.
    #[prost(bytes = "vec", tag = "5")]
    pub prev_state_root: Vec<u8>,
    /// Transaction count in the batch.
    #[prost(uint64, tag = "6")]
    pub tx_count: u64,
    /// Data-availability hash.
    #[prost(bytes = "vec", tag = "7")]
    pub data_hash: Vec<u8>,
    /// Settlement proof.
    #[prost(bytes = "vec", tag = "8")]
    pub proof: Vec<u8>,
    /// Binary Merkle root of the batch's L2->L1 messages.
    #[prost(bytes = "vec", tag = "9")]
    pub withdrawals_root: Vec<u8>,
}

/// `MsgChallengeBatch` -- challenge an optimistic batch.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgChallengeBatch {
    /// Challenger (signer) address.
    #[prost(string, tag = "1")]
    pub challenger: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Batch index.
    #[prost(uint64, tag = "3")]
    pub batch_index: u64,
    /// Fraud proof.
    #[prost(bytes = "vec", tag = "4")]
    pub proof: Vec<u8>,
}

/// `MsgResolveChallenge` -- resolve an open challenge.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgResolveChallenge {
    /// Resolver (signer) address.
    #[prost(string, tag = "1")]
    pub resolver: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Batch index.
    #[prost(uint64, tag = "3")]
    pub batch_index: u64,
    /// Whether fraud was upheld.
    #[prost(bool, tag = "4")]
    pub fraud_upheld: bool,
}

/// `MsgPauseRollup` -- pause an active rollup.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgPauseRollup {
    /// Creator (signer) address.
    #[prost(string, tag = "1")]
    pub creator: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Optional reason.
    #[prost(string, tag = "3")]
    pub reason: String,
}

/// `MsgResumeRollup` -- resume a paused rollup.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgResumeRollup {
    /// Creator (signer) address.
    #[prost(string, tag = "1")]
    pub creator: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
}

/// `MsgStopRollup` -- stop a rollup permanently.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgStopRollup {
    /// Creator (signer) address.
    #[prost(string, tag = "1")]
    pub creator: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
}

/// `MsgExecuteWithdrawal` -- finalize an L2->L1 withdrawal.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgExecuteWithdrawal {
    /// Submitter (signer) address.
    #[prost(string, tag = "1")]
    pub submitter: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Finalized batch index.
    #[prost(uint64, tag = "3")]
    pub batch_index: u64,
    /// Withdrawal index within the batch.
    #[prost(uint64, tag = "4")]
    pub withdrawal_index: u64,
    /// The committed recipient.
    #[prost(string, tag = "5")]
    pub recipient: String,
    /// The withdrawal denom.
    #[prost(string, tag = "6")]
    pub denom: String,
    /// The withdrawal amount.
    #[prost(int64, tag = "7")]
    pub amount: i64,
    /// Sibling hashes from the leaf to `withdrawals_root`.
    #[prost(bytes = "vec", repeated, tag = "8")]
    pub proof: Vec<Vec<u8>>,
}

/// A trait giving each `rdk` message its Cosmos type URL and proto encoding.
pub trait RdkMsg: Message + Sized {
    /// The message's short name (e.g. `MsgCreateRollup`).
    const NAME: &'static str;

    /// The full Cosmos type URL (`/qorechain.rdk.v1.<Name>`).
    fn type_url() -> String {
        format!("{TYPE_URL_PREFIX}{}", Self::NAME)
    }

    /// Encode the message to protobuf bytes.
    fn encode_to_vec_msg(&self) -> Vec<u8> {
        self.encode_to_vec()
    }
}

macro_rules! impl_rdk_msg {
    ($t:ty, $name:literal) => {
        impl RdkMsg for $t {
            const NAME: &'static str = $name;
        }
    };
}

impl_rdk_msg!(MsgCreateRollup, "MsgCreateRollup");
impl_rdk_msg!(MsgSubmitBatch, "MsgSubmitBatch");
impl_rdk_msg!(MsgChallengeBatch, "MsgChallengeBatch");
impl_rdk_msg!(MsgResolveChallenge, "MsgResolveChallenge");
impl_rdk_msg!(MsgPauseRollup, "MsgPauseRollup");
impl_rdk_msg!(MsgResumeRollup, "MsgResumeRollup");
impl_rdk_msg!(MsgStopRollup, "MsgStopRollup");
impl_rdk_msg!(MsgExecuteWithdrawal, "MsgExecuteWithdrawal");
