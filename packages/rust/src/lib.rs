//! Rust Rollup Development Kit for the QoreChain network.
//!
//! **Status: coming soon.** This crate mirrors the conceptual surface of the
//! TypeScript RDK (`@qorechain/rdk`). The enums and constants defined here are
//! stable today; the client surface is not shipped yet and will be filled in
//! following the TypeScript reference implementation.
//!
//! # Planned surface
//!
//! * Typed rollup configuration and a builder, with the settlement /
//!   sequencer / proof / DA / gas / VM compatibility matrix validated
//!   client-side.
//! * The five preset profiles ([`Profile::Defi`], [`Profile::Gaming`],
//!   [`Profile::Nft`], [`Profile::Enterprise`], [`Profile::Custom`]),
//!   pre-filled with their documented defaults.
//! * Lifecycle, settlement-batch, and native data-availability clients.
//! * Read clients for rollups, batches, and module parameters.
//!
//! The enum and constant values below mirror the on-chain `rdk` module exactly.
//! The string values are the wire values the chain expects -- do not localize
//! or re-case them. The documented parameter defaults are NOT a substitute for
//! live chain state: always read the authoritative values with the `rdk params`
//! query surface before acting on them.

/// How a rollup settles to the Main Chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Settlement {
    Optimistic,
    Zk,
    Based,
    Sovereign,
}

impl Settlement {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            Settlement::Optimistic => "optimistic",
            Settlement::Zk => "zk",
            Settlement::Based => "based",
            Settlement::Sovereign => "sovereign",
        }
    }
}

/// Who orders the rollup's transactions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sequencer {
    Dedicated,
    Shared,
    Based,
}

impl Sequencer {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            Sequencer::Dedicated => "dedicated",
            Sequencer::Shared => "shared",
            Sequencer::Based => "based",
        }
    }
}

/// The proof a settlement batch carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProofSystem {
    Fraud,
    Snark,
    Stark,
    None,
}

impl ProofSystem {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            ProofSystem::Fraud => "fraud",
            ProofSystem::Snark => "snark",
            ProofSystem::Stark => "stark",
            ProofSystem::None => "none",
        }
    }
}

/// Where rollup data is made available.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DaBackend {
    Native,
    Celestia,
    Both,
}

impl DaBackend {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            DaBackend::Native => "native",
            DaBackend::Celestia => "celestia",
            DaBackend::Both => "both",
        }
    }
}

/// The fee model the rollup charges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GasModel {
    Standard,
    Eip1559,
    Flat,
    Subsidized,
}

impl GasModel {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            GasModel::Standard => "standard",
            GasModel::Eip1559 => "eip1559",
            GasModel::Flat => "flat",
            GasModel::Subsidized => "subsidized",
        }
    }
}

/// The execution environment the rollup exposes. `Custom` denotes an
/// application-defined VM; the wire value may be any identifier the network
/// recognizes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VmType {
    Evm,
    CosmWasm,
    Svm,
    Custom,
}

impl VmType {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            VmType::Evm => "evm",
            VmType::CosmWasm => "cosmwasm",
            VmType::Svm => "svm",
            VmType::Custom => "custom",
        }
    }
}

/// Rollup lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RollupStatus {
    Pending,
    Active,
    Paused,
    Stopped,
}

impl RollupStatus {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            RollupStatus::Pending => "pending",
            RollupStatus::Active => "active",
            RollupStatus::Paused => "paused",
            RollupStatus::Stopped => "stopped",
        }
    }
}

/// Settlement-batch lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BatchStatus {
    Submitted,
    Challenged,
    Finalized,
    Rejected,
}

impl BatchStatus {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            BatchStatus::Submitted => "submitted",
            BatchStatus::Challenged => "challenged",
            BatchStatus::Finalized => "finalized",
            BatchStatus::Rejected => "rejected",
        }
    }
}

/// The five preset profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Profile {
    Defi,
    Gaming,
    Nft,
    Enterprise,
    Custom,
}

impl Profile {
    /// The wire value the chain expects.
    pub const fn as_str(self) -> &'static str {
        match self {
            Profile::Defi => "defi",
            Profile::Gaming => "gaming",
            Profile::Nft => "nft",
            Profile::Enterprise => "enterprise",
            Profile::Custom => "custom",
        }
    }
}

/// Display denomination.
pub const DISPLAY_DENOM: &str = "QOR";

/// Base denomination.
pub const BASE_DENOM: &str = "uqor";

/// Base units per display unit (10^6).
pub const DENOM_EXPONENT: u32 = 6;

/// Bech32 prefix for account addresses.
pub const ACCOUNT_PREFIX: &str = "qor";

/// Bech32 prefix for validator addresses.
pub const VALIDATOR_PREFIX: &str = "qorvaloper";

/// Testnet chain id. The RDK defaults to testnet.
pub const TESTNET_CHAIN_ID: &str = "qorechain-diana";

/// Mainnet chain id.
pub const MAINNET_CHAIN_ID: &str = "qorechain-vladi";

/// Maximum number of registered rollups (documented default).
pub const DEFAULT_MAX_ROLLUPS: u32 = 100;

/// Minimum stake to create a rollup, in uqor (10,000 QOR; documented default).
pub const DEFAULT_MIN_STAKE_FOR_ROLLUP_UQOR: &str = "10000000000";

/// Fraction of stake burned on creation, as a decimal string (1%; documented
/// default).
pub const DEFAULT_ROLLUP_CREATION_BURN_RATE: &str = "0.01";

/// Default optimistic challenge window, in seconds (7 days; documented default).
pub const DEFAULT_CHALLENGE_WINDOW_SECS: u64 = 604_800;

/// Maximum data-availability blob size, in bytes (2 MiB; documented default).
pub const DEFAULT_MAX_DA_BLOB_SIZE: u64 = 2_097_152;

/// Blocks before expired DA blobs are pruned (~30 days at 6s blocks; documented
/// default).
pub const DEFAULT_BLOB_RETENTION_BLOCKS: u64 = 432_000;

/// Maximum settlement batches accepted per block (documented default).
pub const DEFAULT_MAX_BATCHES_PER_BLOCK: u32 = 10;

/// Default optimistic challenge bond, in uqor (1,000 QOR; documented default).
pub const DEFAULT_CHALLENGE_BOND_UQOR: &str = "1000000000";
