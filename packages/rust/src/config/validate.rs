//! Client-side validation of a rollup configuration against the on-chain rules.

use super::enums::{DaBackend, Sequencer};
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
    }

    // The strongly typed enums guarantee valid value sets; the matrix and the
    // based-sequencer constraint are the remaining cross-field rules.
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
