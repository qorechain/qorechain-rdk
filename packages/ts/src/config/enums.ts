/**
 * The closed sets of values the `rdk` module accepts, as string-literal unions
 * plus the matching runtime arrays (for validation and enumeration).
 *
 * These mirror the on-chain `rdk` module exactly. The strings are the wire
 * values the chain expects — do not localize or re-case them.
 */

/** How a rollup settles to the Main Chain. */
export type SettlementParadigm = "optimistic" | "zk" | "based" | "sovereign";
export const SETTLEMENT_PARADIGMS: readonly SettlementParadigm[] = [
  "optimistic",
  "zk",
  "based",
  "sovereign",
];

/** Who orders the rollup's transactions. */
export type SequencerMode = "dedicated" | "shared" | "based";
export const SEQUENCER_MODES: readonly SequencerMode[] = ["dedicated", "shared", "based"];

/** The proof a settlement batch carries. */
export type ProofSystem = "fraud" | "snark" | "stark" | "none";
export const PROOF_SYSTEMS: readonly ProofSystem[] = ["fraud", "snark", "stark", "none"];

/** Where rollup data is made available. */
export type DABackend = "native" | "celestia" | "both";
export const DA_BACKENDS: readonly DABackend[] = ["native", "celestia", "both"];

/** The fee model the rollup charges. */
export type GasModel = "standard" | "eip1559" | "flat" | "subsidized";
export const GAS_MODELS: readonly GasModel[] = ["standard", "eip1559", "flat", "subsidized"];

/**
 * The execution environment the rollup exposes. `custom` denotes an
 * application-defined VM; the wire value may be any identifier the network
 * recognizes.
 */
export type VmType = "evm" | "cosmwasm" | "svm" | "custom";
export const VM_TYPES: readonly VmType[] = ["evm", "cosmwasm", "svm", "custom"];

/** Rollup lifecycle states. */
export type RollupStatus = "pending" | "active" | "paused" | "stopped";
export const ROLLUP_STATUSES: readonly RollupStatus[] = [
  "pending",
  "active",
  "paused",
  "stopped",
];

/** Settlement-batch lifecycle states. */
export type BatchStatus = "submitted" | "challenged" | "finalized" | "rejected";
export const BATCH_STATUSES: readonly BatchStatus[] = [
  "submitted",
  "challenged",
  "finalized",
  "rejected",
];

/** The five preset profiles. */
export type ProfileName = "defi" | "gaming" | "nft" | "enterprise" | "custom";
export const PROFILE_NAMES: readonly ProfileName[] = [
  "defi",
  "gaming",
  "nft",
  "enterprise",
  "custom",
];
