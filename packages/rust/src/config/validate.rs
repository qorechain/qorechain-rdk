//! Client-side validation of a rollup configuration against the on-chain rules.

use super::enums::{
    is_vm_type, DaBackend, Sequencer, EXECUTION_VMS, PAUSED_PROOF_SYSTEMS, ROLLUP_PRIVACY_MODES,
    SEQUENCING_MODES,
};
use super::errors::RollupConfigError;
use super::matrix::{is_proof_compatible, requires_based_sequencer, valid_proof_systems};
use super::types::RollupConfig;

/// The outcome of validating a [`RollupConfig`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationResult {
    /// True when there are no errors (warnings do not affect validity).
    pub valid: bool,
    /// Hard failures that block submission.
    pub errors: Vec<String>,
    /// Non-fatal notices (e.g. selecting a not-yet-active DA backend).
    pub warnings: Vec<String>,
}

fn is_positive_integer_string(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().next() != Some(b'0')
        && value.bytes().all(|b| b.is_ascii_digit())
}

/// Validate a rollup configuration against the on-chain rules: the
/// settlement -> proof compatibility matrix, the based-settlement =>
/// based-sequencer constraint, and basic field sanity.
///
/// Returns a structured result; callers that prefer to fail fast can use
/// [`assert_valid_rollup_config`].
pub fn validate_rollup_config(config: &RollupConfig) -> ValidationResult {
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    if config.rollup_id.trim().is_empty() {
        errors.push("rollupId must be a non-empty string".to_string());
    } else if let Some(e) = crate::rules::rollup_id_error(&config.rollup_id) {
        // The chain enforces this at creation from v3.2.2; checking here means a
        // refused id costs nothing instead of a creation fee.
        errors.push(format!("rollupId \"{}\" {e}", config.rollup_id));
    }

    // The strongly typed enums guarantee valid value sets; this mirrors the
    // reference's `isVmType` check (the wire value of any `VmType` is accepted).
    if !is_vm_type(config.vm_type.as_str()) {
        errors.push(format!(
            "vmType \"{}\" is not a valid VM type",
            config.vm_type.as_str()
        ));
    }

    // The matrix and the based-sequencer constraint are the remaining
    // cross-field rules.
    if !is_proof_compatible(config.settlement, config.proof_system) {
        let allowed: Vec<&str> = valid_proof_systems(config.settlement)
            .iter()
            .map(|p| p.as_str())
            .collect();
        errors.push(format!(
            "proof system \"{}\" is not compatible with \"{}\" settlement (expected one of: {})",
            config.proof_system.as_str(),
            config.settlement.as_str(),
            allowed.join(", "),
        ));
    }

    // STARK settlement is refused by the chain from v3.2.8.
    if PAUSED_PROOF_SYSTEMS.contains(&config.proof_system) {
        errors.push(format!(
            "proof system \"{}\" is paused on the network: the chain refuses STARK keys and \
             STARK batches until it verifies a real rollup statement; use snark (Groth16)",
            config.proof_system.as_str()
        ));
    }

    // Sequencing, execution VM and privacy (chain v3.2.8+), mirroring the
    // chain's rollup config validation and its create-time rule.
    errors.extend(rollup_mode_errors(&RollupModeInput {
        settlement: config.settlement.as_str(),
        proof_system: config.proof_system.as_str(),
        sequencing: config.sequencing.map(|v| v.as_str()).unwrap_or(""),
        execution_vm: config.execution_vm.map(|v| v.as_str()).unwrap_or(""),
        privacy: config.privacy.map(|v| v.as_str()).unwrap_or(""),
    }));

    if requires_based_sequencer(config.settlement) && config.sequencer != Sequencer::Based {
        errors.push("based settlement requires the \"based\" sequencer mode".to_string());
    }

    if config.block_time_ms <= 0 {
        errors.push("blockTimeMs must be a positive integer".to_string());
    }
    if config.max_tx_per_block <= 0 {
        errors.push("maxTxPerBlock must be a positive integer".to_string());
    }

    if let Some(stake) = &config.stake_amount_uqor {
        if !is_positive_integer_string(stake) {
            errors
                .push("stakeAmountUqor must be a positive integer string (base uqor)".to_string());
        }
    }
    if let Some(window) = config.challenge_window_secs {
        if window <= 0 {
            errors.push("challengeWindowSecs must be a positive integer".to_string());
        }
    }
    if let Some(blob) = config.max_da_blob_size {
        if blob <= 0 {
            errors.push("maxDaBlobSize must be a positive integer (bytes)".to_string());
        }
    }

    if config.da == DaBackend::Celestia || config.da == DaBackend::Both {
        warnings.push(
            "Celestia data availability is selectable but not yet active on the network; \
             batches targeting it will not be served until it is enabled."
                .to_string(),
        );
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

/// Validate a configuration and return [`RollupConfigError`] on any error.
pub fn assert_valid_rollup_config(config: &RollupConfig) -> Result<(), RollupConfigError> {
    let result = validate_rollup_config(config);
    if result.valid {
        Ok(())
    } else {
        Err(RollupConfigError::new(result.errors))
    }
}

/// The fields [`rollup_mode_errors`] judges, as wire strings (`""` = unset).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RollupModeInput<'a> {
    /// Settlement paradigm (`optimistic`, `zk`, `based`, `sovereign`).
    pub settlement: &'a str,
    /// Proof system (`fraud`, `snark`, `stark`, `none`).
    pub proof_system: &'a str,
    /// `""` or `"based"`.
    pub sequencing: &'a str,
    /// `""` or `"qledger-v1"`.
    pub execution_vm: &'a str,
    /// `""` or `"encapsulated"`.
    pub privacy: &'a str,
}

/// The chain's v3.2.8 rules for `sequencing`, `execution_vm` and `privacy` on
/// a new rollup. Returns every violation (empty when the combination is
/// accepted).
///
/// - A new optimistic rollup needs `execution_vm: "qledger-v1"` and
///   `sequencing: "based"`.
/// - `sequencing: "based"` is allowed for zk with snark, based settlement, and
///   optimistic with qledger-v1.
/// - `execution_vm: "qledger-v1"` needs optimistic settlement, based
///   sequencing, and no privacy.
/// - `privacy: "encapsulated"` needs zk settlement with snark.
pub fn rollup_mode_errors(m: &RollupModeInput<'_>) -> Vec<String> {
    let mut errors = Vec::new();
    let RollupModeInput {
        settlement,
        proof_system,
        sequencing,
        execution_vm,
        privacy,
    } = *m;
    if !sequencing.is_empty() && !SEQUENCING_MODES.iter().any(|v| v.as_str() == sequencing) {
        errors.push(format!(
            "sequencing \"{sequencing}\" is not valid (want \"based\" or empty)"
        ));
    }
    if !execution_vm.is_empty() && !EXECUTION_VMS.iter().any(|v| v.as_str() == execution_vm) {
        errors.push(format!(
            "executionVm \"{execution_vm}\" is not valid (want \"qledger-v1\" or empty)"
        ));
    }
    if !privacy.is_empty() && !ROLLUP_PRIVACY_MODES.iter().any(|v| v.as_str() == privacy) {
        errors.push(format!(
            "privacy \"{privacy}\" is not valid (want \"encapsulated\" or empty)"
        ));
    }
    if settlement == "optimistic" && execution_vm.is_empty() {
        errors.push(
            "from chain v3.2.8 a new optimistic rollup needs executionVm \"qledger-v1\" and \
             sequencing \"based\" (its fraud proof re-executes the batch)"
                .to_string(),
        );
    }
    if sequencing == "based" {
        let eligible = (settlement == "zk" && proof_system == "snark")
            || settlement == "based"
            || (settlement == "optimistic" && execution_vm == "qledger-v1");
        if !eligible {
            errors.push(format!(
                "settlement {settlement} with proof system {proof_system} cannot use based \
                 sequencing (zk with snark, based settlement, or optimistic with qledger-v1 only)"
            ));
        }
    }
    if execution_vm == "qledger-v1" {
        if settlement != "optimistic" {
            errors.push(format!(
                "executionVm qledger-v1 needs optimistic settlement, not {settlement}"
            ));
        }
        if sequencing != "based" {
            errors.push(
                "executionVm qledger-v1 needs sequencing \"based\": its batches consume the inbox"
                    .to_string(),
            );
        }
        if !privacy.is_empty() {
            errors.push(
                "a qledger-v1 rollup cannot be private: a fraud proof re-executes plaintext"
                    .to_string(),
            );
        }
    }
    if privacy == "encapsulated" && !(settlement == "zk" && proof_system == "snark") {
        errors.push(format!(
            "a private rollup must be zk with a snark (Groth16) key, not {settlement}/{proof_system}"
        ));
    }
    errors
}
