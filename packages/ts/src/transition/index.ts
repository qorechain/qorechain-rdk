/**
 * The canonical batch transition root: the state root a protocol-following
 * sequencer publishes for a settlement batch.
 *
 * The chain judges an optimistic batch by it. A fraud challenge is upheld when
 * the batch's published `state_root` differs from this root and the challenger
 * names this root (see {@link fraudProof}); from chain v3.2.5 any account may
 * resolve that challenge, and an upheld one is paid from the rollup's escrow.
 * A batch that publishes anything else, such as a placeholder, is provably
 * fraudulent. Vectors in the tests come from the chain's own
 * `BatchTransitionRoot`.
 */
import { shake256 } from "@noble/hashes/sha3";
import { toBytes } from "../utils/bytes";

/** The protocol feature that switches batches to the v2 binding. */
export const FEATURE_RDK_WITHDRAWALS_BINDING = "rdk-withdrawals-binding";

/** The chain upgrade that turns on {@link FEATURE_RDK_WITHDRAWALS_BINDING}. */
export const WITHDRAWALS_BINDING_UPGRADE = "v3.2.5";

/** Which transition binding a batch is judged by. */
export type TransitionRootVersion = "v1" | "v2";

/** The batch fields the transition binding covers. */
export interface TransitionInput {
  /** The state root the batch starts from. */
  prevStateRoot: string | Uint8Array;
  /** The batch's data hash; empty on a native-DA rollup (see `dataHashError`). */
  dataHash?: string | Uint8Array;
  txCount: number | bigint;
  /** v2 only: the network the batch is submitted to. */
  chainId?: string;
  /** v2 only. */
  rollupId?: string;
  /** v2 only: the batch's withdrawals Merkle root, empty or 32 bytes. */
  withdrawalsRoot?: string | Uint8Array;
}

const enc = new TextEncoder();

function u64be(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function shake32(parts: Uint8Array[]): Uint8Array {
  const h = shake256.create({ dkLen: 32 });
  for (const p of parts) h.update(p);
  return h.digest();
}

const bytesOf = (b: string | Uint8Array | undefined): Uint8Array =>
  b === undefined ? new Uint8Array() : toBytes(b);

/**
 * The original binding (every batch before the chain's
 * `rdk-withdrawals-binding` switch):
 * `SHAKE-256(prev_state_root || data_hash || tx_count(8B BE))`, 32 bytes.
 */
export function batchTransitionRootV1(input: TransitionInput): Uint8Array {
  return shake32([bytesOf(input.prevStateRoot), bytesOf(input.dataHash), u64be(input.txCount)]);
}

/**
 * The v2 binding (chain v3.2.5, `rdk-withdrawals-binding`), which also covers
 * the chain id, the rollup id and the withdrawals root. Every variable-length
 * field is prefixed with its 4-byte big-endian length:
 * `SHAKE-256(lp("qorechain-rdk-transition/v2") || lp(chain_id) || lp(rollup_id)
 *  || lp(prev_state_root) || lp(data_hash) || tx_count(8B BE) || lp(withdrawals_root))`.
 */
export function batchTransitionRootV2(input: TransitionInput): Uint8Array {
  if (!input.chainId || !input.rollupId) {
    throw new Error("the v2 transition root covers the chain id and the rollup id; pass both");
  }
  const withdrawalsRoot = bytesOf(input.withdrawalsRoot);
  if (withdrawalsRoot.length !== 0 && withdrawalsRoot.length !== 32) {
    throw new Error(`withdrawalsRoot must be empty or 32 bytes, got ${withdrawalsRoot.length}`);
  }
  const field = (b: Uint8Array): Uint8Array[] => [u32be(b.length), b];
  return shake32([
    ...field(enc.encode("qorechain-rdk-transition/v2")),
    ...field(enc.encode(input.chainId)),
    ...field(enc.encode(input.rollupId)),
    ...field(bytesOf(input.prevStateRoot)),
    ...field(bytesOf(input.dataHash)),
    u64be(input.txCount),
    ...field(withdrawalsRoot),
  ]);
}

/** The transition root under `version`. */
export function batchTransitionRoot(input: TransitionInput, version: TransitionRootVersion): Uint8Array {
  return version === "v2" ? batchTransitionRootV2(input) : batchTransitionRootV1(input);
}

/**
 * Which binding a batch submitted now will be judged by: `v2` once the chain
 * reports `rdk-withdrawals-binding` enabled, `v1` before (including chains that
 * do not serve the feature route). A batch keeps the binding it was submitted
 * under, so compute the root right before submitting, not long in advance:
 * one computed just before the upgrade height and included after it is judged
 * by the other binding.
 */
export async function transitionRootVersionFor(rest: {
  isProtocolFeatureEnabled(name: string): Promise<boolean>;
}): Promise<TransitionRootVersion> {
  return (await rest.isProtocolFeatureEnabled(FEATURE_RDK_WITHDRAWALS_BINDING)) ? "v2" : "v1";
}

/**
 * Which binding the chain judges an **existing** batch by. The chain decides
 * once, at submission: a batch is bound to v2 exactly when it was included at
 * or above the height where {@link WITHDRAWALS_BINDING_UPGRADE} was applied
 * (the upgrade block itself included). The batch's own `withdrawalsBound` is
 * used when the node serves it; otherwise the applied-plan height decides.
 * Challenge only with the root under this version: a fraud proof built on the
 * other binding is dismissed and its bond forfeited.
 */
export async function transitionRootVersionForBatch(
  rest: { getAppliedPlanHeight(name: string): Promise<number> },
  batch: { submittedAt: number; withdrawalsBound?: boolean },
): Promise<TransitionRootVersion> {
  if (batch.withdrawalsBound === true) return "v2";
  const applied = await rest.getAppliedPlanHeight(WITHDRAWALS_BINDING_UPGRADE);
  return applied > 0 && batch.submittedAt >= applied ? "v2" : "v1";
}

/**
 * The fraud proof the chain's optimistic verifier reads:
 * `prev_state_root(32) || correct_state_root(32)`. It is upheld only when the
 * batch's published root differs from the canonical transition root and
 * `correctStateRoot` equals that root.
 */
export function fraudProof(prevStateRoot: string | Uint8Array, correctStateRoot: string | Uint8Array): Uint8Array {
  const prev = toBytes(prevStateRoot);
  const correct = toBytes(correctStateRoot);
  if (prev.length !== 32 || correct.length !== 32) {
    throw new Error("a fraud proof needs a 32-byte previous root and a 32-byte correct root");
  }
  const out = new Uint8Array(64);
  out.set(prev, 0);
  out.set(correct, 32);
  return out;
}
