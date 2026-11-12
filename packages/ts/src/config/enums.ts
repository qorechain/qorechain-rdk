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

/**
 * The proof a settlement batch carries.
 *
 * `stark` stays in the type so rollups created before can be read, but the
 * chain refuses STARK settlement from v3.2.8: a STARK key cannot be set and a
 * STARK rollup's batches are refused until the chain verifies a real rollup
 * statement. New rollups use `snark` (see {@link PAUSED_PROOF_SYSTEMS}).
 */
export type ProofSystem = "fraud" | "snark" | "stark" | "none";
export const PROOF_SYSTEMS: readonly ProofSystem[] = ["fraud", "snark", "stark", "none"];

/** Proof systems the chain currently refuses for new rollups and new batches. */
export const PAUSED_PROOF_SYSTEMS: readonly ProofSystem[] = ["stark"];

/**
 * How a rollup's transactions are ordered (chain v3.2.8+): `""`, the rollup's
 * sequencer settles; `"based"`, anyone posts data, the order is inclusion on
 * the chain, and every batch consumes the inbox in order.
 */
export type SequencingMode = "" | "based";
export const SEQUENCING_MODES: readonly SequencingMode[] = ["", "based"];

/**
 * The execution model the chain re-executes in an optimistic fraud proof
 * (chain v3.2.8+). `qledger-v1` is a uqor account ledger with signed
 * transfers and withdrawals; every new optimistic rollup needs it.
 */
export type ExecutionVm = "" | "qledger-v1";
export const EXECUTION_VMS: readonly ExecutionVm[] = ["", "qledger-v1"];

/** Rollup privacy (chain v3.2.8+): `"encapsulated"` posts are ML-KEM-1024 envelopes to the members. */
export type RollupPrivacy = "" | "encapsulated";
export const ROLLUP_PRIVACY_MODES: readonly RollupPrivacy[] = ["", "encapsulated"];

/** Most members a private rollup can have. */
export const MAX_ROLLUP_MEMBERS = 32;

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
