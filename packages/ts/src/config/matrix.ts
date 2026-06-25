import type { ProofSystem, SettlementParadigm } from "./enums";

/**
 * The settlement → proof-system compatibility matrix enforced by the chain:
 *
 * - `optimistic` → `fraud`
 * - `zk` → `snark` | `stark`
 * - `based` → `none`
 * - `sovereign` → `none`
 */
export const SETTLEMENT_PROOF_MATRIX: Record<SettlementParadigm, readonly ProofSystem[]> = {
  optimistic: ["fraud"],
  zk: ["snark", "stark"],
  based: ["none"],
  sovereign: ["none"],
};

/** Returns the proof systems valid for a settlement paradigm. */
export function validProofSystems(settlement: SettlementParadigm): readonly ProofSystem[] {
  return SETTLEMENT_PROOF_MATRIX[settlement];
}

/** Whether a proof system is compatible with a settlement paradigm. */
export function isProofCompatible(
  settlement: SettlementParadigm,
  proof: ProofSystem,
): boolean {
  return SETTLEMENT_PROOF_MATRIX[settlement].includes(proof);
}

/**
 * Whether a settlement paradigm requires the `based` sequencer mode. Only
 * `based` settlement carries this constraint.
 */
export function requiresBasedSequencer(settlement: SettlementParadigm): boolean {
  return settlement === "based";
}
