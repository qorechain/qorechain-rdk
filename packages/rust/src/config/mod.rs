//! Typed rollup configuration: the closed enum sets, the resolved config
//! struct, the settlement -> proof compatibility matrix, validation, and a
//! fluent builder.

mod builder;
mod enums;
mod errors;
mod matrix;
mod networks;
mod types;
mod validate;

pub use builder::RollupConfigBuilder;
pub use enums::{
    is_proof_system_paused, is_vm_type, vm_type_label, vm_type_wire_value, BatchStatus, DaBackend,
    ExecutionVm, GasModel, Profile, ProofSystem, RollupPrivacy, RollupStatus, Sequencer,
    SequencingMode, Settlement, VmType, BATCH_STATUSES, DA_BACKENDS, EXECUTION_VMS, GAS_MODELS,
    MAX_ROLLUP_MEMBERS, PAUSED_PROOF_SYSTEMS, PROFILE_NAMES, PROOF_SYSTEMS, ROLLUP_PRIVACY_MODES,
    ROLLUP_STATUSES, SEQUENCER_MODES, SEQUENCING_MODES, SETTLEMENT_PARADIGMS, VM_TYPES,
};
pub use errors::RollupConfigError;
pub use matrix::{
    is_proof_compatible, requires_based_sequencer, valid_proof_systems, SETTLEMENT_PROOF_MATRIX,
};
pub use networks::{get_network, list_networks, Endpoints, NetworkConfig};
pub use types::{CreateRollupMsgInput, RollupConfig, SequencerParams};
pub use validate::{
    assert_valid_rollup_config, rollup_mode_errors, validate_rollup_config, RollupModeInput,
    ValidationResult,
};
