//! A fluent builder for a [`RollupConfig`].

use super::enums::{Profile, VmType};
use super::errors::RollupConfigError;
use super::types::{CreateRollupMsgInput, RollupConfig, SequencerParams};
use super::validate::{assert_valid_rollup_config, validate_rollup_config, ValidationResult};

/// A fluent builder for a [`RollupConfig`]. Presets return a builder pre-filled
/// with their defaults; override fields with the `set_*` methods, inspect with
/// [`RollupConfigBuilder::validation_result`], and produce a config with
/// [`RollupConfigBuilder::build`] or an on-chain create message with
/// [`RollupConfigBuilder::to_create_msg`].
#[derive(Debug, Clone)]
pub struct RollupConfigBuilder {
    config: RollupConfig,
}

impl RollupConfigBuilder {
    /// Start a builder from a resolved configuration.
    pub fn new(initial: RollupConfig) -> Self {
        Self { config: initial }
    }

    /// Set the rollup id.
    pub fn set_rollup_id(mut self, rollup_id: impl Into<String>) -> Self {
        self.config.rollup_id = rollup_id.into();
        self
    }

    /// Set the stake amount, in uqor.
    pub fn set_stake_amount_uqor(mut self, stake: impl Into<String>) -> Self {
        self.config.stake_amount_uqor = Some(stake.into());
        self
    }

    /// Override the VM type.
    pub fn set_vm_type(mut self, vm_type: VmType) -> Self {
        self.config.vm_type = vm_type;
        self
    }

    /// Merge `params` into the sequencer params (set fields win; unset keep).
    pub fn merge_sequencer_params(mut self, params: SequencerParams) -> Self {
        let merged = match &self.config.sequencer_params {
            Some(existing) => existing.merged_with(&params),
            None => params,
        };
        self.config.sequencer_params = Some(merged);
        self
    }

    /// Replace the entire configuration with a custom one.
    pub fn with_config(mut self, config: RollupConfig) -> Self {
        self.config = config;
        self
    }

    /// A snapshot copy of the current (not necessarily valid) configuration.
    pub fn get(&self) -> RollupConfig {
        self.config.clone()
    }

    /// The structured validation result for the current configuration.
    pub fn validation_result(&self) -> ValidationResult {
        validate_rollup_config(&self.config)
    }

    /// Validate and return the resolved configuration, or a
    /// [`RollupConfigError`] on any error.
    pub fn build(&self) -> Result<RollupConfig, RollupConfigError> {
        assert_valid_rollup_config(&self.config)?;
        Ok(self.config.clone())
    }

    /// Build the inputs for an on-chain `MsgCreateRollup`. Requires a stake
    /// amount, either on the config (`stake_amount_uqor`) or via `stake_amount`.
    pub fn to_create_msg(
        &self,
        creator: impl Into<String>,
        stake_amount: Option<String>,
    ) -> Result<CreateRollupMsgInput, RollupConfigError> {
        assert_valid_rollup_config(&self.config)?;
        let stake = stake_amount
            .or_else(|| self.config.stake_amount_uqor.clone())
            .ok_or_else(|| {
                RollupConfigError::new(vec![
                    "a stake amount is required to build a create message; set stakeAmountUqor or \
                     pass stake_amount (read the minimum from rdk params())"
                        .to_string(),
                ])
            })?;
        Ok(CreateRollupMsgInput {
            creator: creator.into(),
            rollup_id: self.config.rollup_id.clone(),
            profile: self.config.profile,
            vm_type: self.config.vm_type,
            stake_amount: stake,
        })
    }

    /// The profile this configuration is based on.
    pub fn profile(&self) -> Profile {
        self.config.profile
    }
}
