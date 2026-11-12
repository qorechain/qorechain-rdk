//! Protobuf codecs for the `qorechain.rdk.v1` transaction messages (plus the
//! one `qorechain.pqc.v1` message a private rollup's members need), derived
//! with [`prost`].
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
    /// Chain v3.2.7+: the rollup's ZK verification key, registered at
    /// creation, in the encoding `MsgSetVerificationKey` takes. Empty: none.
    #[prost(bytes = "vec", tag = "6")]
    pub verification_key: Vec<u8>,
    /// Chain v3.2.8+: `""` (the rollup's sequencer settles) or `"based"`
    /// (transactions are ordered by their inclusion on the chain, and every
    /// batch consumes the inbox in order). zk (snark), based settlement, and
    /// qledger-v1 optimistic rollups only.
    #[prost(string, tag = "7")]
    pub sequencing: String,
    /// Chain v3.2.8+: `""` or `"qledger-v1"` (optimistic, must be based).
    #[prost(string, tag = "8")]
    pub execution_vm: String,
    /// Chain v3.2.8+: `""` or `"encapsulated"` (zk with a Groth16 key only).
    #[prost(string, tag = "9")]
    pub privacy: String,
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
    /// Chain v3.2.8+: for a based rollup, the inbox sequence of the last post
    /// this batch consumes; `data_hash` must then be the inbox range
    /// commitment. Zero for every other rollup.
    #[prost(uint64, tag = "12")]
    pub inbox_end: u64,
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

// ---------------------------------------------------------------------------
// Messages added in chain v3.2.7 (verification keys) and v3.2.8 (posted data,
// based sequencing, qledger-v1 rollups, private rollups).
// ---------------------------------------------------------------------------

/// `MsgSetVerificationKey` -- register or replace a zk rollup's verification
/// key (chain v3.2.7+). Signed by the creator, before the rollup's first batch
/// only. For `snark` the key is a Groth16 BLS12-381 verifying key in gnark's
/// binary encoding for a circuit with exactly four public inputs
/// (prev_state_root, state_root, data_hash, withdrawals_root). From v3.2.8 a
/// `stark` key is refused.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgSetVerificationKey {
    /// Creator (signer) address.
    #[prost(string, tag = "1")]
    pub creator: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// The verification key.
    #[prost(bytes = "vec", tag = "3")]
    pub verification_key: Vec<u8>,
    /// `"snark"`, or empty to keep the rollup's proof system.
    #[prost(string, tag = "4")]
    pub proof_system: String,
}

/// `MsgUpdateVerificationKey` -- governance-only key replacement (chain
/// v3.2.7+); `authority` is the gov module account.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgUpdateVerificationKey {
    /// The gov module account.
    #[prost(string, tag = "1")]
    pub authority: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// The verification key.
    #[prost(bytes = "vec", tag = "3")]
    pub verification_key: Vec<u8>,
    /// The proof system the key is for.
    #[prost(string, tag = "4")]
    pub proof_system: String,
}

/// `MsgPostRollupData` -- put rollup data on chain (chain v3.2.8+). The chain
/// keeps a commitment (SHA-256 of `data`) under the rollup's next inbox
/// sequence; a native-DA batch may then carry that SHA-256 as its
/// `data_hash`. Who may post: the rollup's sequencer (its creator when none is
/// set); anyone on a based rollup.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgPostRollupData {
    /// Poster (signer) address.
    #[prost(string, tag = "1")]
    pub poster: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// The payload (an envelope on a private rollup).
    #[prost(bytes = "vec", tag = "3")]
    pub data: Vec<u8>,
}

/// `MsgPostRollupDataResponse`.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgPostRollupDataResponse {
    /// The inbox sequence the post was given (from 1).
    #[prost(uint64, tag = "1")]
    pub sequence: u64,
    /// SHA-256 of the data: the hash a batch references.
    #[prost(bytes = "vec", tag = "2")]
    pub data_hash: Vec<u8>,
}

/// `MsgSetRollupSequencing` -- governance-only move to based sequencing
/// (`"based"`) or back (`""`), chain v3.2.8+.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgSetRollupSequencing {
    /// The gov module account.
    #[prost(string, tag = "1")]
    pub authority: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// `"based"` or `""`.
    #[prost(string, tag = "3")]
    pub sequencing: String,
}

/// `MsgDepositToRollup` -- move `amount` uqor into a qledger-v1 rollup's
/// deposit pool and credit the 32-byte L2 `account` through the rollup's inbox
/// (chain v3.2.8+). At least 1 QOR (1,000,000 uqor).
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgDepositToRollup {
    /// Depositor (signer) address.
    #[prost(string, tag = "1")]
    pub depositor: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// The 32-byte qledger-v1 account id to credit.
    #[prost(bytes = "vec", tag = "3")]
    pub account: Vec<u8>,
    /// Amount, in uqor.
    #[prost(uint64, tag = "4")]
    pub amount: u64,
}

/// `MsgDepositToRollupResponse`.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgDepositToRollupResponse {
    /// The inbox sequence of the deposit entry.
    #[prost(uint64, tag = "1")]
    pub sequence: u64,
}

/// `MsgBondRollupSubmitter` -- add `amount` uqor to the submitter's bond on a
/// qledger-v1 rollup (chain v3.2.8+).
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgBondRollupSubmitter {
    /// Submitter (signer) address.
    #[prost(string, tag = "1")]
    pub submitter: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// Amount, in uqor.
    #[prost(uint64, tag = "3")]
    pub amount: u64,
}

/// `MsgBondRollupSubmitterResponse`.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgBondRollupSubmitterResponse {
    /// The bond after this message, in uqor.
    #[prost(uint64, tag = "1")]
    pub bond: u64,
}

/// `MsgUnbondRollupSubmitter` -- return the submitter's whole bond, a full
/// challenge window after its last batch (chain v3.2.8+).
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgUnbondRollupSubmitter {
    /// Submitter (signer) address.
    #[prost(string, tag = "1")]
    pub submitter: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
}

/// `MsgUnbondRollupSubmitterResponse`.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgUnbondRollupSubmitterResponse {
    /// The amount returned, in uqor.
    #[prost(uint64, tag = "1")]
    pub returned: u64,
}

/// `MsgSetRollupMembers` -- set a private rollup's member list (chain
/// v3.2.8+): at most 32 canonical account addresses, each with a registered
/// ML-KEM-1024 key. Signed by the creator; each change starts a new membership
/// epoch.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgSetRollupMembers {
    /// Creator (signer) address.
    #[prost(string, tag = "1")]
    pub creator: String,
    /// Target rollup id.
    #[prost(string, tag = "2")]
    pub rollup_id: String,
    /// The members, in envelope order.
    #[prost(string, repeated, tag = "3")]
    pub members: Vec<String>,
}

/// `MsgSetRollupMembersResponse`.
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgSetRollupMembersResponse {
    /// The new membership epoch.
    #[prost(uint64, tag = "1")]
    pub epoch: u64,
}

/// The type-URL prefix of the chain's `pqc` module messages.
pub const PQC_TYPE_URL_PREFIX: &str = "/qorechain.pqc.v1.";

/// `MsgRegisterKEMKey` (`/qorechain.pqc.v1.MsgRegisterKEMKey`) -- publish the
/// sender's key-encapsulation public key in the chain's KEM registry (`x/pqc`,
/// chain v3.2.5+). A private rollup's members need an ML-KEM-1024 key there
/// (`algorithm_id` 2, the 1568-byte FIPS 203 encapsulation key).
#[derive(Clone, PartialEq, Eq, Message)]
pub struct MsgRegisterKemKey {
    /// Sender (signer) address.
    #[prost(string, tag = "1")]
    pub sender: String,
    /// The algorithm id (2 = ML-KEM-1024).
    #[prost(uint32, tag = "2")]
    pub algorithm_id: u32,
    /// The encapsulation (public) key.
    #[prost(bytes = "vec", tag = "3")]
    pub public_key: Vec<u8>,
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
impl_rdk_msg!(MsgSetVerificationKey, "MsgSetVerificationKey");
impl_rdk_msg!(MsgUpdateVerificationKey, "MsgUpdateVerificationKey");
impl_rdk_msg!(MsgPostRollupData, "MsgPostRollupData");
impl_rdk_msg!(MsgPostRollupDataResponse, "MsgPostRollupDataResponse");
impl_rdk_msg!(MsgSetRollupSequencing, "MsgSetRollupSequencing");
impl_rdk_msg!(MsgDepositToRollup, "MsgDepositToRollup");
impl_rdk_msg!(MsgDepositToRollupResponse, "MsgDepositToRollupResponse");
impl_rdk_msg!(MsgBondRollupSubmitter, "MsgBondRollupSubmitter");
impl_rdk_msg!(
    MsgBondRollupSubmitterResponse,
    "MsgBondRollupSubmitterResponse"
);
impl_rdk_msg!(MsgUnbondRollupSubmitter, "MsgUnbondRollupSubmitter");
impl_rdk_msg!(
    MsgUnbondRollupSubmitterResponse,
    "MsgUnbondRollupSubmitterResponse"
);
impl_rdk_msg!(MsgSetRollupMembers, "MsgSetRollupMembers");
impl_rdk_msg!(MsgSetRollupMembersResponse, "MsgSetRollupMembersResponse");

impl RdkMsg for MsgRegisterKemKey {
    const NAME: &'static str = "MsgRegisterKEMKey";

    /// A `pqc` module message: `/qorechain.pqc.v1.MsgRegisterKEMKey`.
    fn type_url() -> String {
        format!("{PQC_TYPE_URL_PREFIX}{}", Self::NAME)
    }
}
