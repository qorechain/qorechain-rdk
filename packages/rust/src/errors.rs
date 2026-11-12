//! Readable decoding of a transaction the `rdk` module refused.
//!
//! [`qorechain::tx::decode_tx_error`] names the `sdk` codespace's codes and
//! falls back to a generic reason for a module's own. This adds the `rdk`
//! module's codes, copied from the chain's error registry, with what to do
//! about the ones a rollup operator meets.

/// One `rdk` codespace error: a stable kind, its message, and a hint where
/// there is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RdkErrorInfo {
    /// A stable, machine-readable kind (e.g. `"rollup_not_found"`).
    pub kind: &'static str,
    /// The chain's message.
    pub message: &'static str,
    /// What to do about it, where there is something to say.
    pub hint: Option<&'static str>,
}

const fn info(
    kind: &'static str,
    message: &'static str,
    hint: Option<&'static str>,
) -> RdkErrorInfo {
    RdkErrorInfo {
        kind,
        message,
        hint,
    }
}

/// The `rdk` codespace's error `code`, as the chain registers it (2 to 54), or
/// `None` for a code it does not register.
pub fn rdk_error_info(code: u32) -> Option<RdkErrorInfo> {
    Some(match code {
        2 => info("rollup_not_found", "rollup not found", None),
        3 => info("rollup_already_exists", "rollup already exists", None),
        4 => info("rollup_not_active", "rollup not active", None),
        5 => info("max_rollups_reached", "maximum rollups reached", Some("every max_rollups slot is taken")),
        6 => info("insufficient_stake", "insufficient stake amount", Some("stake at least min_stake_for_rollup")),
        7 => info("unauthorized", "only the rollup creator can do this", None),
        8 => info("batch_not_found", "batch not found", None),
        9 => info("batch_exists", "a batch with this index already exists", None),
        10 => info("challenge_window_closed", "challenge window closed or not applicable", Some("a batch can be challenged only while its own window is open")),
        11 => info("invalid_proof", "invalid proof", None),
        12 => info("proof_required", "proof required for this settlement mode", None),
        13 => info("da_blob_too_large", "DA blob exceeds the maximum size", None),
        14 => info("da_blob_not_found", "DA blob not found", None),
        15 => info("celestia_unavailable", "Celestia data availability is not active", None),
        16 => info("invalid_settlement_mode", "invalid settlement mode", None),
        17 => info("invalid_sequencer_mode", "invalid sequencer mode", None),
        18 => info("invalid_proof_system", "invalid proof system", None),
        19 => info("based_sequencer_only", "based settlement requires a based sequencer", None),
        20 => info("challenge_bond_required", "a challenge bond is required", None),
        21 => info("verification_key_missing", "ZK verification key not configured for the rollup", Some("register one with MsgSetVerificationKey (chain v3.2.7+) before the rollup's first batch")),
        22 => info("stark_not_supported", "STARK verification is not available for this rollup", None),
        23 => info("proof_verify_failed", "ZK proof verification failed", None),
        24 => info("no_open_challenge", "no open challenge for this batch", None),
        25 => info("batch_not_challenged", "batch is not challenged", None),
        26 => info("data_unavailable", "no DA blob matches the batch's data hash", Some("post the data with MsgPostRollupData (chain v3.2.8+) and carry its SHA-256, or leave data_hash empty")),
        27 => info("batch_not_finalized", "withdrawals need a finalized batch", None),
        28 => info("withdrawal_already_done", "withdrawal already executed", None),
        29 => info("invalid_withdrawal_proof", "withdrawal proof does not match the batch's withdrawals root", Some("build it with withdrawalsTree, using the batch's own binding (v2 from chain v3.2.5)")),
        30 => info("invalid_rollup_id", "invalid rollup id", None),
        31 => info("anchor_refused", "the batch's signed state anchor was refused", Some("only the rollup creator's registered post-quantum key can sign the anchor")),
        32 => info("insufficient_escrow", "the rollup's escrow does not cover the withdrawal", None),
        33 => info("invalid_withdrawal", "malformed withdrawal message", None),
        34 => info("params_update_disabled", "rdk parameter updates are not enabled at this height", None),
        35 => info("invalid_params", "invalid rdk parameters", None),
        36 => info("settlement_pending", "the rollup has a batch that is not settled yet", Some("a rollup cannot be stopped, and cannot take more than 4096 waiting batches, while batches are unsettled")),
        37 => info("verification_key_disabled", "verification key registration is not enabled at this height", None),
        38 => info("invalid_verification_key", "invalid ZK verification key", None),
        39 => info("verification_key_locked", "the verification key can only be changed by governance after the first batch", None),
        40 => info("batch_limit_reached", "the rollup reached max_batches_per_block in this block", None),
        41 => info("rollup_data_disabled", "rollup data posting is not enabled at this height", None),
        42 => info("rollup_data_too_large", "rollup data exceeds the per-message limit", Some("see max_posted_data_bytes")),
        43 => info("rollup_data_block_full", "the rollup data limit for this block is reached", Some("retry in a later block")),
        44 => info("based_sequencing_disabled", "based sequencing is not enabled at this height", None),
        45 => info("based_sequencing_unsupported", "based sequencing is not available for this rollup", Some("zk (snark), based settlement and qledger-v1 optimistic rollups only")),
        46 => info("invalid_inbox_range", "the batch does not match the rollup inbox", Some("data_hash must be the inbox range commitment up to inbox_end; inbox_end must be 0 on a rollup that is not based")),
        47 => info("rollup_mode_disabled", "this rollup mode is not enabled at this height", None),
        48 => info("invalid_rollup_mode", "invalid rollup execution or privacy mode", Some("a new optimistic rollup needs execution_vm qledger-v1 and based sequencing; a private rollup must be zk with a Groth16 key")),
        49 => info("submitter_bond_required", "submitter bond required", Some("bond at least min_submitter_bond first")),
        50 => info("submitter_bond_locked", "the submitter bond is still locked", Some("a full challenge window must pass after the submitter's last batch")),
        51 => info("fraud_not_proven", "the fraud proof does not show the batch invalid", None),
        52 => info("stark_statement_unsupported", "this STARK verification key proves no rollup statement", Some("STARK settlement is paused; use a Groth16 (snark) key")),
        53 => info("invalid_envelope", "the post is not a valid envelope to the rollup's members", None),
        54 => info("deposit_pool_not_empty", "the rollup still holds user deposits", None),
        _ => return None,
    })
}

/// A decoded refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedRdkTxError {
    /// The non-zero ABCI result code.
    pub code: u32,
    /// The codespace (`"rdk"`, `"sdk"`, ...).
    pub codespace: String,
    /// The stable kind for an `rdk` code; empty for other codespaces.
    pub kind: String,
    /// A readable message (with the hint appended for an `rdk` code that has
    /// one).
    pub message: String,
    /// What to do about it, for an `rdk` code that has a hint.
    pub hint: Option<String>,
    /// The chain's raw log.
    pub raw_log: String,
}

/// Decode a refusal: the `rdk` codespace by [`rdk_error_info`], every other
/// codespace (and an unknown `rdk` code) by the SDK's
/// [`qorechain::tx::decode_tx_error`]. `None` for code 0 (success).
pub fn decode_rdk_tx_error(code: u32, codespace: &str, raw_log: &str) -> Option<DecodedRdkTxError> {
    if code == 0 {
        return None;
    }
    if codespace == "rdk" {
        if let Some(info) = rdk_error_info(code) {
            return Some(DecodedRdkTxError {
                code,
                codespace: "rdk".to_string(),
                kind: info.kind.to_string(),
                message: match info.hint {
                    Some(h) => format!("{} ({h})", info.message),
                    None => info.message.to_string(),
                },
                hint: info.hint.map(str::to_string),
                raw_log: raw_log.to_string(),
            });
        }
    }
    let sdk = qorechain::tx::decode_tx_error(code, codespace, raw_log)?;
    Some(DecodedRdkTxError {
        code: sdk.code,
        codespace: sdk.codespace,
        kind: String::new(),
        message: sdk.reason,
        hint: None,
        raw_log: sdk.raw_log,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_every_registered_code() {
        for c in 2..=54 {
            assert!(rdk_error_info(c).is_some(), "code {c}");
        }
        assert!(rdk_error_info(1).is_none());
        assert!(rdk_error_info(55).is_none());
    }
}
