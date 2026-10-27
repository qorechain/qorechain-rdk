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

/**
 * Why a batch with `dataHash` would be refused for a rollup on `daBackend`, or
 * `undefined` if the chain accepts it.
 *
 * On a `native` or `both` rollup the chain accepts a non-empty `data_hash` only
 * when a matching blob is stored on chain, and no transaction stores one: the
 * batch is refused as data unavailable. Leave `dataHash` empty there; the
 * batch's state roots and proof still bind it. (`celestia` is not checked by
 * the chain, and is not active on the network.)
 */
export function dataHashError(daBackend: string, dataHash: Uint8Array | string | undefined): string | undefined {
  const empty =
    dataHash === undefined ||
    (typeof dataHash === "string" ? dataHash.replace(/^0x/i, "") === "" : dataHash.length === 0);
  if (empty || (daBackend !== "native" && daBackend !== "both")) return undefined;
  return (
    `dataHash must be empty on a rollup with ${daBackend} data availability: no transaction stores ` +
    "a data-availability blob on chain, so the chain refuses a batch that claims one"
  );
}

/**
 * Why a batch's `withdrawalsRoot` would be refused, or `undefined` if it is
 * acceptable. From chain v3.2.5 (`rdk-withdrawals-binding`) it must be empty or
 * exactly 32 bytes, the root of the batch's withdrawals tree.
 */
export function withdrawalsRootError(withdrawalsRoot: Uint8Array | string | undefined): string | undefined {
  if (withdrawalsRoot === undefined) return undefined;
  const n =
    typeof withdrawalsRoot === "string"
      ? withdrawalsRoot.replace(/^0x/i, "").length / 2
      : withdrawalsRoot.length;
  return n === 0 || n === 32 ? undefined : `withdrawalsRoot must be empty or 32 bytes, got ${n}`;
}

/**
 * From chain v3.2.5 (`rdk-challenge-settlement`) an optimistic rollup may have
 * at most this many batches waiting for finality; the next one is refused.
 */
export const MAX_PENDING_OPTIMISTIC_BATCHES = 4096;

/**
 * Why stopping a rollup would be refused, given the status of its latest batch,
 * or `undefined` if it would not be. From chain v3.2.5
 * (`rdk-challenge-settlement`) a rollup whose latest batch is still submitted
 * or challenged cannot be stopped: stopping refunds the escrow that pays an
 * upheld challenge.
 */
export function stopRollupError(latestBatchStatus: string | undefined): string | undefined {
  return latestBatchStatus === "submitted" || latestBatchStatus === "challenged"
    ? `the rollup's latest batch is ${latestBatchStatus}; stop it once that batch is finalized or rejected`
    : undefined;
}
