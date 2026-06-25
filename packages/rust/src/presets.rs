//! The five preset profiles and their documented default fields.
//!
//! These mirror the network's published profile table. The proof system for
//! each profile is the one its settlement paradigm requires (optimistic ->
//! fraud, zk -> snark, based -> none).

use crate::config::{
    DaBackend, GasModel, Profile, ProofSystem, RollupConfig, RollupConfigBuilder, Sequencer,
    Settlement, VmType,
};
use crate::constants::{DEFAULT_CHALLENGE_BOND_UQOR, DEFAULT_CHALLENGE_WINDOW_SECS};

/// The documented default fields for a profile (excluding the per-user
/// `rollup_id` and stake).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetDefaults {
    /// Settlement paradigm.
    pub settlement: Settlement,
    /// Sequencer mode.
    pub sequencer: Sequencer,
    /// Data-availability backend.
    pub da: DaBackend,
    /// Proof system.
    pub proof_system: ProofSystem,
    /// Gas / fee model.
    pub gas_model: GasModel,
    /// Execution environment.
    pub vm_type: VmType,
    /// Target block time, in milliseconds.
    pub block_time_ms: i64,
    /// Maximum transactions per rollup block.
    pub max_tx_per_block: i64,
    /// Optimistic challenge window, in seconds.
    pub challenge_window_secs: Option<i64>,
    /// Optimistic challenge bond, in uqor.
    pub challenge_bond_uqor: Option<String>,
}

/// The documented default fields for a profile.
pub fn preset_defaults(profile: Profile) -> PresetDefaults {
    match profile {
        Profile::Defi => PresetDefaults {
            settlement: Settlement::Zk,
            sequencer: Sequencer::Dedicated,
            da: DaBackend::Native,
            proof_system: ProofSystem::Snark,
            gas_model: GasModel::Eip1559,
            vm_type: VmType::Evm,
            block_time_ms: 500,
            max_tx_per_block: 10000,
            challenge_window_secs: None,
            challenge_bond_uqor: None,
        },
        Profile::Gaming => PresetDefaults {
            settlement: Settlement::Based,
            sequencer: Sequencer::Based,
            da: DaBackend::Native,
            proof_system: ProofSystem::None,
            gas_model: GasModel::Flat,
            vm_type: VmType::Custom,
            block_time_ms: 200,
            max_tx_per_block: 50000,
            challenge_window_secs: None,
            challenge_bond_uqor: None,
        },
        Profile::Nft => PresetDefaults {
            settlement: Settlement::Optimistic,
            sequencer: Sequencer::Dedicated,
            da: DaBackend::Celestia,
            proof_system: ProofSystem::Fraud,
            gas_model: GasModel::Standard,
            vm_type: VmType::CosmWasm,
            block_time_ms: 2000,
            max_tx_per_block: 5000,
            challenge_window_secs: Some(DEFAULT_CHALLENGE_WINDOW_SECS as i64),
            challenge_bond_uqor: Some(DEFAULT_CHALLENGE_BOND_UQOR.to_string()),
        },
        Profile::Enterprise => PresetDefaults {
            settlement: Settlement::Based,
            sequencer: Sequencer::Based,
            da: DaBackend::Native,
            proof_system: ProofSystem::None,
            gas_model: GasModel::Subsidized,
            vm_type: VmType::Evm,
            block_time_ms: 1000,
            max_tx_per_block: 20000,
            challenge_window_secs: None,
            challenge_bond_uqor: None,
        },
        Profile::Custom => PresetDefaults {
            settlement: Settlement::Optimistic,
            sequencer: Sequencer::Dedicated,
            da: DaBackend::Native,
            proof_system: ProofSystem::Fraud,
            gas_model: GasModel::Standard,
            vm_type: VmType::Evm,
            block_time_ms: 1000,
            max_tx_per_block: 10000,
            challenge_window_secs: Some(DEFAULT_CHALLENGE_WINDOW_SECS as i64),
            challenge_bond_uqor: Some(DEFAULT_CHALLENGE_BOND_UQOR.to_string()),
        },
    }
}

/// Build a [`RollupConfigBuilder`] pre-filled with a profile's documented
/// defaults. The `profile` field always reflects the chosen preset (it is the
/// wire value sent in the create message).
pub fn preset(profile: Profile) -> RollupConfigBuilder {
    let d = preset_defaults(profile);
    let config = RollupConfig {
        rollup_id: String::new(),
        profile,
        settlement: d.settlement,
        sequencer: d.sequencer,
        sequencer_params: None,
        da: d.da,
        proof_system: d.proof_system,
        gas_model: d.gas_model,
        vm_type: d.vm_type,
        block_time_ms: d.block_time_ms,
        max_tx_per_block: d.max_tx_per_block,
        challenge_window_secs: d.challenge_window_secs,
        challenge_bond_uqor: d.challenge_bond_uqor,
        max_da_blob_size: None,
        stake_amount_uqor: None,
    };
    RollupConfigBuilder::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defi_defaults_match() {
        let d = preset_defaults(Profile::Defi);
        assert_eq!(d.settlement, Settlement::Zk);
        assert_eq!(d.proof_system, ProofSystem::Snark);
        assert_eq!(d.block_time_ms, 500);
        assert_eq!(d.max_tx_per_block, 10000);
    }
}
