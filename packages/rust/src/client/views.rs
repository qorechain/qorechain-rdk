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
    /// Submission unix timestamp (seconds).
    pub submitted_at: i64,
    /// Finalization unix timestamp (seconds).
    pub finalized_at: i64,
    /// Withdrawals Merkle root (hex).
    pub withdrawals_root: String,
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
    }
}
