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
 * The execution environment the rollup exposes.
 *
 * - `evm` — Ethereum/Solidity.
 * - `native` — the QoreChain Native runtime (Wasm smart contracts).
 * - `svm` — the Solana VM.
 * - `custom` — an application-defined VM.
 *
 * `cosmwasm` is accepted as a legacy alias of `native` and is what both map to
 * on the wire (the network, explorer, and dashboard use `cosmwasm`).
 */
export type VmType = "evm" | "native" | "svm" | "custom" | "cosmwasm";
/** The advertised VM types (`native` is the QoreChain Native runtime). */
export const VM_TYPES: readonly VmType[] = ["evm", "native", "svm", "custom"];

const ACCEPTED_VM_TYPES = new Set<string>([...VM_TYPES, "cosmwasm"]);

/** Whether `value` is a VM type the RDK accepts (includes the `cosmwasm` alias). */
export function isVmType(value: string): boolean {
  return ACCEPTED_VM_TYPES.has(value);
}

/**
 * The on-chain wire value for a VM type. The QoreChain Native runtime (`native`)
 * is transmitted as `cosmwasm` for consistency with the network, explorer, and
 * dashboard; all other values pass through unchanged.
 */
export function vmTypeWireValue(vmType: string): string {
  return vmType === "native" ? "cosmwasm" : vmType;
}

/** A human-readable label for a VM type (the Wasm runtime reads as QoreChain Native). */
export function vmTypeLabel(vmType: string): string {
  switch (vmType) {
    case "native":
    case "cosmwasm":
      return "QoreChain Native";
    case "evm":
      return "EVM";
    case "svm":
      return "SVM";
    case "custom":
      return "Custom";
    default:
      return vmType;
  }
}

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
