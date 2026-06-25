//! The resolved rollup configuration struct and the create-message input.

use serde::{Deserialize, Serialize};

use super::enums::{DaBackend, GasModel, Profile, ProofSystem, Sequencer, Settlement, VmType};

/// Mode-specific sequencer parameters. Which fields apply depends on the
/// sequencer mode: `dedicated` uses `sequencer_address`, `shared` uses
/// `shared_set_min_size`, and `based` uses `inclusion_delay` /
/// `priority_fee_share`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SequencerParams {
    /// `dedicated`: the operator address that sequences the rollup.
    #[serde(rename = "sequencerAddress", skip_serializing_if = "Option::is_none")]
    pub sequencer_address: Option<String>,
    /// `shared`: minimum size of the shared sequencer set.
    #[serde(rename = "sharedSetMinSize", skip_serializing_if = "Option::is_none")]
    pub shared_set_min_size: Option<u64>,
    /// `based`: blocks of inclusion delay for host-chain proposers.
    #[serde(rename = "inclusionDelay", skip_serializing_if = "Option::is_none")]
    pub inclusion_delay: Option<u64>,
    /// `based`: share of priority fees routed to proposers, as a decimal string.
    #[serde(rename = "priorityFeeShare", skip_serializing_if = "Option::is_none")]
    pub priority_fee_share: Option<String>,
}

impl SequencerParams {
    /// Whether all fields are unset.
    pub fn is_empty(&self) -> bool {
        self.sequencer_address.is_none()
            && self.shared_set_min_size.is_none()
            && self.inclusion_delay.is_none()
            && self.priority_fee_share.is_none()
    }

    /// Merge `overrides` onto `self`, returning the merged value. Set fields in
    /// `overrides` win; unset fields keep `self`.
    pub fn merged_with(&self, overrides: &SequencerParams) -> SequencerParams {
        SequencerParams {
            sequencer_address: overrides
                .sequencer_address
                .clone()
                .or_else(|| self.sequencer_address.clone()),
            shared_set_min_size: overrides.shared_set_min_size.or(self.shared_set_min_size),
            inclusion_delay: overrides.inclusion_delay.or(self.inclusion_delay),
            priority_fee_share: overrides
                .priority_fee_share
                .clone()
                .or_else(|| self.priority_fee_share.clone()),
        }
    }
}

/// A fully resolved rollup configuration.
///
/// On creation the chain derives a rollup's settlement, sequencing, data
/// availability, gas, and timing from its `profile` (and `vm_type`). This struct
/// captures the resolved configuration for client-side validation, display, and
/// to build a `MsgCreateRollup`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RollupConfig {
    /// Unique rollup identifier.
    #[serde(rename = "rollupId")]
    pub rollup_id: String,
    /// The preset profile this configuration is based on.
    pub profile: Profile,
    /// Settlement paradigm.
    pub settlement: Settlement,
    /// Sequencer mode.
    pub sequencer: Sequencer,
    /// Mode-specific sequencer parameters.
    #[serde(rename = "sequencerParams", skip_serializing_if = "Option::is_none")]
    pub sequencer_params: Option<SequencerParams>,
    /// Data-availability backend.
    pub da: DaBackend,
    /// Proof system (must be compatible with `settlement`).
    #[serde(rename = "proofSystem")]
    pub proof_system: ProofSystem,
    /// Gas / fee model.
    #[serde(rename = "gasModel")]
    pub gas_model: GasModel,
    /// Execution environment.
    #[serde(rename = "vmType")]
    pub vm_type: VmType,
    /// Target block time, in milliseconds.
    #[serde(rename = "blockTimeMs")]
    pub block_time_ms: i64,
    /// Maximum transactions per rollup block.
    #[serde(rename = "maxTxPerBlock")]
    pub max_tx_per_block: i64,
    /// Optimistic challenge window, in seconds.
    #[serde(
        rename = "challengeWindowSecs",
        skip_serializing_if = "Option::is_none"
    )]
    pub challenge_window_secs: Option<i64>,
    /// Optimistic challenge bond, in uqor.
    #[serde(rename = "challengeBondUqor", skip_serializing_if = "Option::is_none")]
    pub challenge_bond_uqor: Option<String>,
    /// Maximum DA blob size, in bytes.
    #[serde(rename = "maxDaBlobSize", skip_serializing_if = "Option::is_none")]
    pub max_da_blob_size: Option<i64>,
    /// Stake committed at creation, in uqor. Required to build a create message.
    #[serde(rename = "stakeAmountUqor", skip_serializing_if = "Option::is_none")]
    pub stake_amount_uqor: Option<String>,
}

/// Inputs for an on-chain `MsgCreateRollup`, as the kit submits them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRollupMsgInput {
    /// The creator/operator address.
    pub creator: String,
    /// Unique rollup identifier.
    pub rollup_id: String,
    /// The preset profile.
    pub profile: Profile,
    /// Execution environment.
    pub vm_type: VmType,
    /// Stake committed at creation, in uqor.
    pub stake_amount: String,
}
