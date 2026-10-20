/**
 * Client-side copies of rules the chain enforces, so a transaction the chain
 * would refuse is caught **before** a fee is paid.
 *
 * Both rule sets are deliberately checked by the chain in the keeper rather
 * than in `ValidateBasic` (tightening `ValidateBasic` would retroactively refuse
 * what historical blocks accepted), which means the chain can only tell you
 * after you have paid. These mirror them exactly; where they disagree, the
 * chain wins and this module is the bug.
 */
import { bech32 } from "bech32";

/** Shortest and longest rollup/layer id the chain accepts. */
export const ID_MIN_LENGTH = 3;
export const ID_MAX_LENGTH = 64;

/**
 * Why `id` does not match the chain's id grammar, or `undefined` if it does.
 *
 * From chain v3.2.2 a **new** rollup or layer id must match
 * `^[a-z0-9][a-z0-9._-]{2,63}$`: lowercase letters, digits, `.`, `_` and `-`,
 * 3 to 64 bytes, starting with a letter or digit. A rollup registers its layer
 * under the same id. Ids are store-key components joined with `/`, so an id
 * containing `/` — or sorting as another id's extension — let one layer's
 * anchors, batches or blobs be read as another's. Ids created before v3.2.2
 * may sit outside the grammar and stay valid; this is for choosing a new one.
 */
export function rollupIdError(id: string): string | undefined {
  // The chain measures bytes; for the allowed (ASCII) alphabet bytes equal
  // characters, and any non-ASCII character is rejected below anyway.
  const len = new TextEncoder().encode(id).length;
  if (len < ID_MIN_LENGTH || len > ID_MAX_LENGTH) {
    return `must be ${ID_MIN_LENGTH} to ${ID_MAX_LENGTH} characters`;
  }
  for (let i = 0; i < id.length; i++) {
    const c = id[i];
    const lowerOrDigit = (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
    if (lowerOrDigit) continue;
    if ((c === "." || c === "_" || c === "-") && i > 0) continue;
    return i === 0
      ? "must start with a lowercase letter or a digit"
      : "may contain only lowercase letters, digits, '.', '_' and '-'";
  }
  return undefined;
}

/** Whether `id` is a valid new rollup/layer id. */
export function isValidRollupId(id: string): boolean {
  return rollupIdError(id) === undefined;
}

/** The only denomination a rollup's escrow ledger can pay a withdrawal in. */
export const ROLLUP_ESCROW_DENOM = "uqor";

/**
 * The longest withdrawal Merkle path the chain accepts: a batch commits at
 * most 2^64 withdrawals, so a longer path can never verify.
 */
export const MAX_WITHDRAWAL_PROOF_DEPTH = 64;

/** The fields of a withdrawal the chain validates up front. */
export interface WithdrawalForValidation {
  submitter: string;
  rollupId: string;
  recipient: string;
  denom: string;
  amount: number | bigint | string;
  /** Merkle siblings, each as raw bytes or hex. */
  proof?: Array<Uint8Array | string>;
}

function isBech32(address: string): boolean {
  try {
    bech32.decode(address);
    return true;
  } catch {
    return false;
  }
}

function byteLength(x: Uint8Array | string): number {
  if (typeof x !== "string") return x.length;
  const hex = x.startsWith("0x") || x.startsWith("0X") ? x.slice(2) : x;
  return hex.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(hex) ? hex.length / 2 : -1;
}

/**
 * Every reason the chain would refuse this withdrawal at the start of
 * `ExecuteWithdrawal` (chain v3.2.3+, `rdk-escrow-ledger`), or an empty list.
 * Mirrors `MsgExecuteWithdrawal.ValidateWithdrawal`.
 */
export function withdrawalErrors(w: WithdrawalForValidation): string[] {
  const errors: string[] = [];
  if (!isBech32(w.submitter)) errors.push(`invalid submitter address "${w.submitter}"`);
  // Only emptiness: ids from before v3.2.2 may sit outside the grammar.
  if (!w.rollupId) errors.push("rollup_id cannot be empty");
  if (!isBech32(w.recipient)) errors.push(`invalid recipient address "${w.recipient}"`);
  if (w.denom !== ROLLUP_ESCROW_DENOM) {
    errors.push(`denom "${w.denom}": rollup escrow is held in ${ROLLUP_ESCROW_DENOM} only`);
  }
  let positive = false;
  try {
    positive = BigInt(w.amount) > 0n;
  } catch {
    /* not an integer */
  }
  if (!positive) errors.push("amount must be a positive integer");
  const proof = w.proof ?? [];
  if (proof.length > MAX_WITHDRAWAL_PROOF_DEPTH) {
    errors.push(`proof has ${proof.length} levels, at most ${MAX_WITHDRAWAL_PROOF_DEPTH}`);
  }
  proof.forEach((sibling, i) => {
    const n = byteLength(sibling);
    if (n !== 32) errors.push(`proof level ${i} is ${n < 0 ? "not valid hex" : `${n} bytes`}, want 32`);
  });
  return errors;
}
