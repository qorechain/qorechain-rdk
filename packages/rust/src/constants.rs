//! Network and module constants for the QoreChain `rdk` module.
//!
//! The parameter values here are the network's documented defaults. They are
//! NOT a substitute for the live chain state: always read the authoritative
//! values with the `rdk params` query surface before acting on them.

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

/// Named network. The RDK defaults to testnet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Network {
    /// The public testnet (`qorechain-diana`).
    #[default]
    Testnet,
    /// Mainnet (`qorechain-vladi`).
    Mainnet,
}

impl Network {
    /// The network name as a wire string.
    pub const fn as_str(self) -> &'static str {
        match self {
            Network::Testnet => "testnet",
            Network::Mainnet => "mainnet",
        }
    }

    /// The chain id for this network.
    pub const fn chain_id(self) -> &'static str {
        match self {
            Network::Testnet => TESTNET_CHAIN_ID,
            Network::Mainnet => MAINNET_CHAIN_ID,
        }
    }
}
