//! Typed, camelCase/snake_case-tolerant views of the `rdk` query responses,
//! with mappers from the REST/JSON-RPC JSON payloads. Cosmos REST encodes 64-bit
//! integers as strings; amounts that can be large (stakes) are kept as strings,
//! while small bounded counters are parsed to numbers.

use serde_json::Value;

use crate::utils::bytes::hex_bytes;

/// Normalize a wire bytes field (base64 or hex) to a lowercase hex string.
fn hex_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => hex_bytes(s),
        _ => String::new(),
    }
}

fn pick<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let map = obj.as_object()?;
    for key in keys {
        if let Some(v) = map.get(*key) {
            if !v.is_null() {
                return Some(v);
            }
        }
    }
    None
}

fn str_of(value: Option<&Value>, fallback: &str) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => fallback.to_string(),
    }
}

fn num_of(value: Option<&Value>, fallback: i64) -> i64 {
    match value {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(fallback),
        Some(Value::String(s)) => s.parse().unwrap_or(fallback),
        _ => fallback,
    }
}

/// Module parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamsView {
    /// Maximum number of registered rollups.
    pub max_rollups: i64,
    /// Minimum stake to create a rollup, in uqor.
    pub min_stake_for_rollup: String,
    /// Fraction of stake burned on creation, as a decimal string.
    pub rollup_creation_burn_rate: String,
    /// Default optimistic challenge window, in seconds.
    pub default_challenge_window: i64,
    /// Maximum DA blob size, in bytes.
    pub max_da_blob_size: i64,
    /// Blocks before expired DA blobs are pruned.
    pub blob_retention_blocks: i64,
    /// Maximum settlement batches accepted per block.
    pub max_batches_per_block: i64,
    /// Chain v3.2.8+ (effective values; `None` from an older node): blocks a
    /// finalized batch is kept.
    pub finalized_batch_retention_blocks: Option<i64>,
    /// Chain v3.2.8+: largest `MsgPostRollupData` payload, in bytes.
    pub max_posted_data_bytes: Option<i64>,
    /// Chain v3.2.8+: posted bytes allowed per block.
    pub max_posted_data_bytes_per_block: Option<i64>,
    /// Chain v3.2.8+: fee per billable posted byte, in uqor.
    pub posted_data_fee_per_byte: Option<i64>,
    /// Chain v3.2.8+: blocks a post's commitment is retained.
    pub posted_data_retention_blocks: Option<i64>,
    /// Chain v3.2.8+: bond a qledger-v1 batch submitter must hold, in uqor.
    pub min_submitter_bond: Option<String>,
}

/// A rollup's configuration and status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollupView {
    /// Unique rollup id.
    pub rollup_id: String,
    /// Creator address.
    pub creator: String,
    /// Preset profile.
    pub profile: String,
    /// Settlement mode.
    pub settlement_mode: String,
    /// Data-availability backend.
    pub da_backend: String,
    /// Block time, in milliseconds.
    pub block_time_ms: i64,
    /// Maximum transactions per block.
    pub max_tx_per_block: i64,
    /// Execution environment.
    pub vm_type: String,
    /// Lifecycle status.
    pub status: String,
    /// Stake committed, in uqor.
    pub stake_amount: String,
    /// The host layer id.
    pub layer_id: String,
    /// The block height the rollup was created at.
    pub created_height: i64,
    /// What the rollup still holds in the pooled module escrow, in uqor (chain
    /// v3.2.3+). `"0"` from an older node.
    pub escrow_balance: String,
    /// The rollup's own challenge window in seconds (chain v3.2.4+), or `None`
    /// from a node that does not expose it. The window is per rollup, so the
    /// global `default_challenge_window` param is only a fallback.
    pub challenge_window_sec: Option<u64>,
    /// The rollup's challenge bond in uqor (chain v3.2.4+).
    pub challenge_bond: Option<String>,
    /// The rollup's proof system, e.g. `fraud` (chain v3.2.4+).
    pub proof_system: Option<String>,
    /// Whether the rollup has a ZK verification key registered (chain v3.2.7+,
    /// `MsgSetVerificationKey`). True only when the node serves the field as
    /// true; a node that does not serve it means none: every zk batch is then
    /// refused.
    pub has_verification_key: bool,
    /// Chain v3.2.8+: `"based"` or `""` (the rollup's sequencer settles).
    pub sequencing: String,
    /// Chain v3.2.8+: `"qledger-v1"` or `""`.
    pub execution_vm: String,
    /// Chain v3.2.8+: `"encapsulated"` or `""`.
    pub privacy: String,
    /// Chain v3.2.8+: a private rollup's members, in envelope order.
    pub members: Vec<String>,
    /// Chain v3.2.8+: the membership epoch an envelope must carry.
    pub members_epoch: i64,
    /// Chain v3.2.8+: uqor deposited into a qledger-v1 rollup and not
    /// withdrawn. `"0"` from an older node.
    pub deposit_pool: String,
}

/// A settlement batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchView {
    /// Target rollup id.
    pub rollup_id: String,
    /// Batch index.
    pub batch_index: i64,
    /// Post-state root (hex).
    pub state_root: String,
    /// Previous-state root (hex).
    pub prev_state_root: String,
    /// Transaction count.
    pub tx_count: i64,
    /// Data-availability hash (hex).
    pub data_hash: String,
    /// Proof type.
    pub proof_type: String,
    /// Lifecycle status.
    pub status: String,
    /// The **block height** the batch was submitted at — not a timestamp.
    /// Releases before 0.6.0 documented and used it as Unix seconds, which
    /// broke every challenge deadline the health monitor computed.
    pub submitted_at: i64,
    /// The block height the batch was finalized at (0 while pending).
    pub finalized_at: i64,
    /// Withdrawals Merkle root (hex).
    pub withdrawals_root: String,
    /// The submission block's time (Unix seconds) for a batch under the chain's
    /// time-based challenge window (v3.2.4). Zero for every earlier batch,
    /// which keeps the block-count window.
    pub submitted_time: i64,
    /// Whether the chain judges this batch by the v2 transition binding (chain
    /// v3.2.5, `rdk-withdrawals-binding`). True only when the node serves the
    /// field as true; `transition_root_version_for_batch` otherwise decides by
    /// height.
    pub withdrawals_bound: bool,
    /// Chain v3.2.8+, based rollups: the inbox range the batch consumed (after
    /// `inbox_start`, up to `inbox_end`).
    pub inbox_start: i64,
    /// See `inbox_start`.
    pub inbox_end: i64,
    /// Chain v3.2.8+: the stored `withdrawals_root` is the submitted root
    /// reduced modulo the BLS12-381 scalar field (a Groth16 batch that binds
    /// its withdrawals, settled with `rdk-zk-canonical-inputs` on). Compare a
    /// tree root with it modulo r ([`crate::zk::withdrawals_root_matches`]),
    /// not byte for byte.
    pub withdrawals_root_reduced: bool,
}

/// A rollup's inbox (chain v3.2.8+). Hash fields are as the node serves them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxView {
    /// The rollup id.
    pub rollup_id: String,
    /// The rollup's sequencing.
    pub sequencing: String,
    /// Sequence of the last post (0 = none yet).
    pub head_sequence: i64,
    /// The accumulator at the head.
    pub head_acc: String,
    /// Where the next based batch starts.
    pub consumed_sequence: i64,
    /// The accumulator at the consumed position.
    pub consumed_acc: String,
    /// The range end `range_data_hash` is for.
    pub range_end: i64,
    /// The `data_hash` a based batch with `inbox_end = range_end` must carry;
    /// empty when no longer retained.
    pub range_data_hash: String,
}

/// One posted-data commitment (chain v3.2.8+).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostedDataView {
    /// The rollup id.
    pub rollup_id: String,
    /// The inbox sequence.
    pub sequence: i64,
    /// SHA-256 of the payload, as the node serves it.
    pub data_hash: String,
    /// Payload size, in bytes.
    pub size: i64,
    /// The poster address.
    pub poster: String,
    /// The block whose transaction carries the payload.
    pub height: i64,
    /// The inbox accumulator after this post.
    pub inbox_acc: String,
    /// The height the commitment expires at.
    pub expires_at_height: i64,
}

/// A submitter's bond on a qledger-v1 rollup (chain v3.2.8+).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitterBondView {
    /// uqor; `"0"` when there is none.
    pub amount: String,
    /// Block time (Unix seconds) of the submitter's last batch.
    pub last_submit_time: i64,
    /// Block time (Unix seconds) from which an unbond succeeds.
    pub unbond_after: i64,
    /// The submitter's batches on the rollup still waiting for finality
    /// (chain v3.2.8+; at most 1,024).
    pub pending: i64,
}

/// A key-encapsulation key an address published (`x/pqc`, chain v3.2.5+).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KemKeyView {
    /// The address.
    pub address: String,
    /// The algorithm id (2 = ML-KEM-1024).
    pub algorithm_id: i64,
    /// The algorithm name.
    pub algorithm_name: String,
    /// The FIPS 203 encapsulation key, lowercase hex.
    pub public_key: String,
    /// The height the key was registered at.
    pub registered_height: i64,
}

/// A subsidiary-layer state anchor committed to the Main Chain (the
/// `x/multilayer` `StateAnchorView`). Byte fields are normalized to lowercase
/// hex. The PQC (Dilithium-5 / ML-DSA-87) signature covers the canonical message
/// `layer_id || layer_height(8B BE) || state_root || validator_set_hash`, signed
/// by the layer creator's registered post-quantum key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnchorView {
    /// The anchoring layer id.
    pub layer_id: String,
    /// The anchored layer height.
    pub layer_height: u64,
    /// The anchored state root (hex).
    pub state_root: String,
    /// The anchored validator-set hash (hex).
    pub validator_set_hash: String,
    /// The Main Chain height the anchor was committed at.
    pub main_chain_height: i64,
    /// Anchor unix timestamp (seconds).
    pub anchored_at: i64,
    /// The post-quantum anchor signature (hex).
    pub pqc_signature: String,
    /// Number of transactions covered by the anchored state.
    pub transaction_count: i64,
    /// Compressed state proof (hex).
    pub compressed_state_proof: String,
}

/// A post-quantum account view (the `x/pqc` `PQCAccountView`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PqcAccountView {
    /// The account address.
    pub address: String,
    /// The registered ML-DSA-87 (Dilithium-5) verification key (hex).
    pub public_key: String,
    /// The post-quantum algorithm id.
    pub algorithm_id: i64,
    /// The post-quantum algorithm name.
    pub algorithm_name: String,
}

/// Map a raw JSON object into an [`AnchorView`].
pub fn map_anchor_view(raw: &Value) -> AnchorView {
    AnchorView {
        layer_id: str_of(pick(raw, &["layer_id", "layerId"]), ""),
        layer_height: num_of(pick(raw, &["layer_height", "layerHeight"]), 0).max(0) as u64,
        state_root: hex_of(pick(raw, &["state_root", "stateRoot"])),
        validator_set_hash: hex_of(pick(raw, &["validator_set_hash", "validatorSetHash"])),
        main_chain_height: num_of(pick(raw, &["main_chain_height", "mainChainHeight"]), 0),
        anchored_at: num_of(pick(raw, &["anchored_at", "anchoredAt"]), 0),
        pqc_signature: hex_of(pick(
            raw,
            &["pqc_aggregate_signature", "pqcAggregateSignature"],
        )),
        transaction_count: num_of(pick(raw, &["transaction_count", "transactionCount"]), 0),
        compressed_state_proof: hex_of(pick(
            raw,
            &["compressed_state_proof", "compressedStateProof"],
        )),
    }
}

/// Map a raw JSON object into a [`PqcAccountView`].
pub fn map_pqc_account_view(raw: &Value) -> PqcAccountView {
    PqcAccountView {
        address: str_of(pick(raw, &["address"]), ""),
        public_key: hex_of(pick(raw, &["public_key", "publicKey"])),
        algorithm_id: num_of(pick(raw, &["algorithm_id", "algorithmId"]), 0),
        algorithm_name: str_of(pick(raw, &["algorithm_name", "algorithmName"]), ""),
    }
}

/// Map a raw JSON object into a [`ParamsView`].
pub fn map_params_view(raw: &Value) -> ParamsView {
    ParamsView {
        max_rollups: num_of(pick(raw, &["max_rollups", "maxRollups"]), 0),
        min_stake_for_rollup: str_of(
            pick(raw, &["min_stake_for_rollup", "minStakeForRollup"]),
            "0",
        ),
        rollup_creation_burn_rate: str_of(
            pick(
                raw,
                &["rollup_creation_burn_rate", "rollupCreationBurnRate"],
            ),
            "0",
        ),
        default_challenge_window: num_of(
            pick(raw, &["default_challenge_window", "defaultChallengeWindow"]),
            0,
        ),
        max_da_blob_size: num_of(pick(raw, &["max_da_blob_size", "maxDaBlobSize"]), 0),
        blob_retention_blocks: num_of(
            pick(raw, &["blob_retention_blocks", "blobRetentionBlocks"]),
            0,
        ),
        max_batches_per_block: num_of(
            pick(raw, &["max_batches_per_block", "maxBatchesPerBlock"]),
            0,
        ),
        finalized_batch_retention_blocks: opt_num(
            raw,
            &[
                "finalized_batch_retention_blocks",
                "finalizedBatchRetentionBlocks",
            ],
        ),
        max_posted_data_bytes: opt_num(raw, &["max_posted_data_bytes", "maxPostedDataBytes"]),
        max_posted_data_bytes_per_block: opt_num(
            raw,
            &[
                "max_posted_data_bytes_per_block",
                "maxPostedDataBytesPerBlock",
            ],
        ),
        posted_data_fee_per_byte: opt_num(
            raw,
            &["posted_data_fee_per_byte", "postedDataFeePerByte"],
        ),
        posted_data_retention_blocks: opt_num(
            raw,
            &["posted_data_retention_blocks", "postedDataRetentionBlocks"],
        ),
        min_submitter_bond: present(pick(raw, &["min_submitter_bond", "minSubmitterBond"]))
            .map(|v| str_of(Some(v), "")),
    }
}

/// A number the node may not send (absent, null or empty reads as `None`).
fn opt_num(raw: &Value, keys: &[&str]) -> Option<i64> {
    present(pick(raw, keys)).map(|v| num_of(Some(v), 0))
}

/// Map a raw JSON object into an [`InboxView`].
pub fn map_inbox_view(raw: &Value) -> InboxView {
    InboxView {
        rollup_id: str_of(pick(raw, &["rollup_id", "rollupId"]), ""),
        sequencing: str_of(pick(raw, &["sequencing"]), ""),
        head_sequence: num_of(pick(raw, &["head_sequence", "headSequence"]), 0),
        head_acc: str_of(pick(raw, &["head_acc", "headAcc"]), ""),
        consumed_sequence: num_of(pick(raw, &["consumed_sequence", "consumedSequence"]), 0),
        consumed_acc: str_of(pick(raw, &["consumed_acc", "consumedAcc"]), ""),
        range_end: num_of(pick(raw, &["range_end", "rangeEnd"]), 0),
        range_data_hash: str_of(pick(raw, &["range_data_hash", "rangeDataHash"]), ""),
    }
}

/// Map a raw JSON object into a [`PostedDataView`].
pub fn map_posted_data_view(raw: &Value) -> PostedDataView {
    PostedDataView {
        rollup_id: str_of(pick(raw, &["rollup_id", "rollupId"]), ""),
        sequence: num_of(pick(raw, &["sequence"]), 0),
        data_hash: str_of(pick(raw, &["data_hash", "dataHash"]), ""),
        size: num_of(pick(raw, &["size"]), 0),
        poster: str_of(pick(raw, &["poster"]), ""),
        height: num_of(pick(raw, &["height"]), 0),
        inbox_acc: str_of(pick(raw, &["inbox_acc", "inboxAcc"]), ""),
        expires_at_height: num_of(pick(raw, &["expires_at_height", "expiresAtHeight"]), 0),
    }
}

/// Map a raw JSON object into a [`SubmitterBondView`].
pub fn map_submitter_bond_view(raw: &Value) -> SubmitterBondView {
    SubmitterBondView {
        amount: str_of(pick(raw, &["amount"]), "0"),
        last_submit_time: num_of(pick(raw, &["last_submit_time", "lastSubmitTime"]), 0),
        unbond_after: num_of(pick(raw, &["unbond_after", "unbondAfter"]), 0),
        pending: num_of(pick(raw, &["pending"]), 0),
    }
}

/// Map a raw JSON object into a [`KemKeyView`].
pub fn map_kem_key_view(raw: &Value) -> KemKeyView {
    KemKeyView {
        address: str_of(pick(raw, &["address"]), ""),
        algorithm_id: num_of(pick(raw, &["algorithm_id", "algorithmId"]), 0),
        algorithm_name: str_of(pick(raw, &["algorithm_name", "algorithmName"]), ""),
        public_key: hex_of(pick(raw, &["public_key", "publicKey"])),
        registered_height: num_of(pick(raw, &["registered_height", "registeredHeight"]), 0),
    }
}

/// Map a raw JSON object into a [`RollupView`].
pub fn map_rollup_view(raw: &Value) -> RollupView {
    RollupView {
        rollup_id: str_of(pick(raw, &["rollup_id", "rollupId"]), ""),
        creator: str_of(pick(raw, &["creator"]), ""),
        profile: str_of(pick(raw, &["profile"]), ""),
        settlement_mode: str_of(pick(raw, &["settlement_mode", "settlementMode"]), ""),
        da_backend: str_of(pick(raw, &["da_backend", "daBackend"]), ""),
        block_time_ms: num_of(pick(raw, &["block_time_ms", "blockTimeMs"]), 0),
        max_tx_per_block: num_of(pick(raw, &["max_tx_per_block", "maxTxPerBlock"]), 0),
        vm_type: str_of(pick(raw, &["vm_type", "vmType"]), ""),
        status: str_of(pick(raw, &["status"]), ""),
        stake_amount: str_of(pick(raw, &["stake_amount", "stakeAmount"]), "0"),
        layer_id: str_of(pick(raw, &["layer_id", "layerId"]), ""),
        created_height: num_of(pick(raw, &["created_height", "createdHeight"]), 0),
        escrow_balance: str_of(pick(raw, &["escrow_balance", "escrowBalance"]), "0"),
        challenge_window_sec: present(pick(raw, &["challenge_window_sec", "challengeWindowSec"]))
            .map(|v| num_of(Some(v), 0).max(0) as u64),
        challenge_bond: present(pick(raw, &["challenge_bond", "challengeBond"]))
            .map(|v| str_of(Some(v), "")),
        proof_system: present(pick(raw, &["proof_system", "proofSystem"]))
            .map(|v| str_of(Some(v), "")),
        has_verification_key: pick(raw, &["has_verification_key", "hasVerificationKey"])
            == Some(&Value::Bool(true)),
        sequencing: str_of(pick(raw, &["sequencing"]), ""),
        execution_vm: str_of(pick(raw, &["execution_vm", "executionVm"]), ""),
        privacy: str_of(pick(raw, &["privacy"]), ""),
        members: pick(raw, &["members"])
            .and_then(Value::as_array)
            .map(|arr| arr.iter().map(|v| str_of(Some(v), "")).collect())
            .unwrap_or_default(),
        members_epoch: num_of(pick(raw, &["members_epoch", "membersEpoch"]), 0),
        deposit_pool: str_of(pick(raw, &["deposit_pool", "depositPool"]), "0"),
    }
}

/// `None` when the node did not send the field (absent, null or empty).
fn present(value: Option<&Value>) -> Option<&Value> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.is_empty() => None,
        other => other,
    }
}

/// Map a raw JSON object into a [`BatchView`].
pub fn map_batch_view(raw: &Value) -> BatchView {
    BatchView {
        rollup_id: str_of(pick(raw, &["rollup_id", "rollupId"]), ""),
        batch_index: num_of(pick(raw, &["batch_index", "batchIndex"]), 0),
        state_root: str_of(pick(raw, &["state_root", "stateRoot"]), ""),
        prev_state_root: str_of(pick(raw, &["prev_state_root", "prevStateRoot"]), ""),
        tx_count: num_of(pick(raw, &["tx_count", "txCount"]), 0),
        data_hash: str_of(pick(raw, &["data_hash", "dataHash"]), ""),
        proof_type: str_of(pick(raw, &["proof_type", "proofType"]), ""),
        status: str_of(pick(raw, &["status"]), ""),
        submitted_at: num_of(pick(raw, &["submitted_at", "submittedAt"]), 0),
        finalized_at: num_of(pick(raw, &["finalized_at", "finalizedAt"]), 0),
        withdrawals_root: str_of(pick(raw, &["withdrawals_root", "withdrawalsRoot"]), ""),
        submitted_time: num_of(pick(raw, &["submitted_time", "submittedTime"]), 0),
        withdrawals_bound: pick(raw, &["withdrawals_bound", "withdrawalsBound"])
            == Some(&Value::Bool(true)),
        inbox_start: num_of(pick(raw, &["inbox_start", "inboxStart"]), 0),
        inbox_end: num_of(pick(raw, &["inbox_end", "inboxEnd"]), 0),
        withdrawals_root_reduced: pick(
            raw,
            &["withdrawals_root_reduced", "withdrawalsRootReduced"],
        ) == Some(&Value::Bool(true)),
    }
}
