/**
 * Network and module constants for the QoreChain `rdk` module.
 *
 * The parameter values here are the network's documented defaults. They are NOT
 * a substitute for the live chain state: always read the authoritative values
 * with `rdk.params()` (the `query rdk params` surface) before acting on them.
 */

/** Display denomination. */
export const DISPLAY_DENOM = "QOR";

/** Base denomination. */
export const BASE_DENOM = "uqor";

/** Base units per display unit (10^6). */
export const DENOM_EXPONENT = 6;

/** Bech32 prefix for account addresses. */
export const ACCOUNT_PREFIX = "qor";

/** Bech32 prefix for validator addresses. */
export const VALIDATOR_PREFIX = "qorvaloper";

/** Named networks and their chain ids. The RDK defaults to testnet. */
export const CHAIN_IDS = {
  testnet: "qorechain-diana",
  mainnet: "qorechain-vladi",
} as const;

export type NetworkName = keyof typeof CHAIN_IDS;

/**
 * Documented defaults for the `rdk` module parameters. Read the live values
 * from the chain with `rdk.params()`; treat these as reference only.
 */
export const DEFAULT_RDK_PARAMS = {
  /** Maximum number of registered rollups. */
  maxRollups: 100,
  /** Minimum stake to create a rollup, in uqor (10,000 QOR). */
  minStakeForRollup: "10000000000",
  /** Fraction of stake burned on creation, as a decimal string (1%). */
  rollupCreationBurnRate: "0.01",
  /** Default optimistic challenge window, in seconds (7 days). */
  defaultChallengeWindow: 604800,
  /** Maximum data-availability blob size, in bytes (2 MiB). */
  maxDaBlobSize: 2097152,
  /** Blocks before expired DA blobs are pruned (~30 days at 6s blocks). */
  blobRetentionBlocks: 432000,
  /** Maximum settlement batches accepted per block. */
  maxBatchesPerBlock: 10,
} as const;

/** Default optimistic challenge bond, in uqor (1,000 QOR). */
export const DEFAULT_CHALLENGE_BOND_UQOR = "1000000000";

/** Protocol switches of the chain v3.2.7 and v3.2.8 RDK features, as `x/pqc` reports them. */
export const RDK_FEATURES = {
  zkVerificationKey: "rdk-zk-verification-key",
  postRollupData: "rdk-post-rollup-data",
  basedSequencing: "rdk-based-sequencing",
  optimisticReexec: "rdk-optimistic-reexec",
  starkStatement: "rdk-stark-statement",
  privateRollups: "rdk-private-rollups",
  zkCanonicalInputs: "rdk-zk-canonical-inputs",
  maxBatchesPerBlock: "rdk-max-batches-per-block",
} as const;

/**
 * Posted-data retention (chain v3.2.8): default 648,000 blocks; a set value is
 * 100 to 25,920,000 blocks and at least the longest challenge window in force,
 * counted as one block per second.
 */
export const DEFAULT_POSTED_DATA_RETENTION_BLOCKS = 648_000;
export const MIN_POSTED_DATA_RETENTION_BLOCKS = 100;
export const MAX_POSTED_DATA_RETENTION_BLOCKS = 25_920_000;

/** Smallest `MsgDepositToRollup` amount, in uqor (1 QOR). */
export const MIN_ROLLUP_DEPOSIT_UQOR = 1_000_000n;
/** Default `min_submitter_bond`, in uqor (1,000 QOR); read the live value from `rdk.params()`. */
export const DEFAULT_MIN_SUBMITTER_BOND_UQOR = 1_000_000_000n;
