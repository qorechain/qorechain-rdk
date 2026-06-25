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
    BatchStatus, DaBackend, GasModel, Profile, ProofSystem, RollupStatus, Sequencer, Settlement,
    VmType, BATCH_STATUSES, DA_BACKENDS, GAS_MODELS, PROFILE_NAMES, PROOF_SYSTEMS, ROLLUP_STATUSES,
    SEQUENCER_MODES, SETTLEMENT_PARADIGMS, VM_TYPES,
};
pub use errors::RollupConfigError;
pub use matrix::{
    is_proof_compatible, requires_based_sequencer, valid_proof_systems, SETTLEMENT_PROOF_MATRIX,
};
pub use networks::{get_network, list_networks, Endpoints, NetworkConfig};
pub use types::{CreateRollupMsgInput, RollupConfig, SequencerParams};
pub use validate::{assert_valid_rollup_config, validate_rollup_config, ValidationResult};
