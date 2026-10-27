/**
 * Withdrawal-proof assembly for `MsgExecuteWithdrawal`.
 *
 * A withdrawal is executed by proving its leaf is committed in a finalized
 * batch's `withdrawals_root`. This helper turns the batch's withdrawal leaves
 * into the sibling-hash proof the message carries.
 *
 * Use {@link withdrawalsTree}: it builds the chain's own leaves and tree, so its
 * root and proofs are what `MsgExecuteWithdrawal` verifies (tested against the
 * chain's `VerifyWithdrawalMerkle`). The chain places each withdrawal at its
 * index, hashes nodes as SHAKE-256(left || right), and pairs an odd last node
 * with itself. A batch submitted from chain v3.2.5 (`rdk-withdrawals-binding`)
 * commits v2 leaves, which also name the chain id; check which with
 * `transitionRootVersionForBatch`.
 */
import { binaryMerkleProof, binaryMerkleRoot, type MerkleOptions } from "./merkle";
import type { ExecuteWithdrawalInput } from "../tx/messages";
import { qorehash } from "../utils/qorehash";

/** One L2 to L1 withdrawal as the chain hashes it. */
export interface WithdrawalLeafInput {
  rollupId: string;
  /** The withdrawal's position in its batch; also its leaf position. */
  withdrawalIndex: number | bigint;
  recipient: string;
  denom: string;
  amount: number | bigint | string;
}

const te = new TextEncoder();

function u64be(value: number | bigint | string): Uint8Array {
  let v = BigInt(value);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

const u32be = (n: number): Uint8Array =>
  new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const lp = (b: Uint8Array): Uint8Array[] => [u32be(b.length), b];
const ZERO = new Uint8Array([0]);

/**
 * The chain's original withdrawal leaf (every batch before
 * `rdk-withdrawals-binding`): SHAKE-256(rollup_id || 0x00 ||
 * withdrawal_index(8B BE) || recipient || 0x00 || denom || 0x00 || amount(8B BE)).
 */
export function withdrawalLeafV1(w: WithdrawalLeafInput): Uint8Array {
  return qorehash(
    te.encode(w.rollupId),
    ZERO,
    u64be(w.withdrawalIndex),
    te.encode(w.recipient),
    ZERO,
    te.encode(w.denom),
    ZERO,
    u64be(w.amount),
  );
}

/**
 * The v2 leaf of a batch bound under chain v3.2.5: the same fields,
 * length-prefixed, behind a tag and the chain id, so a withdrawal committed for
 * one network has no valid proof on another.
 */
export function withdrawalLeafV2(chainId: string, w: WithdrawalLeafInput): Uint8Array {
  if (!chainId) throw new Error("a v2 withdrawal leaf names the chain id; pass it");
  return qorehash(
    ...lp(te.encode("qorechain-rdk-withdrawal/v2")),
    ...lp(te.encode(chainId)),
    ...lp(te.encode(w.rollupId)),
    u64be(w.withdrawalIndex),
    ...lp(te.encode(w.recipient)),
    ...lp(te.encode(w.denom)),
    u64be(w.amount),
  );
}

/** The chain's tree over already-hashed leaves. */
const CHAIN_TREE: MerkleOptions = { hashLeaves: false, duplicateOdd: true };

/** A batch's withdrawals, hashed and committed exactly as the chain does. */
export interface WithdrawalsTree {
  /** The batch's `withdrawals_root` (32 bytes). */
  root: Uint8Array;
  /** The leaves, in withdrawal-index order. */
  leaves: Uint8Array[];
  /** The proof for the withdrawal at `withdrawalIndex`. */
  proof(withdrawalIndex: number): WithdrawalProof;
}

/**
 * Build a batch's withdrawals tree. Withdrawal `i` of `withdrawals` is
 * withdrawal index `i`. `version` must be the binding the chain judges the
 * batch by: `v2` (with `chainId`) for a batch submitted from chain v3.2.5's
 * `rdk-withdrawals-binding`, `v1` before.
 */
export function withdrawalsTree(
  withdrawals: Array<{ recipient: string; denom: string; amount: number | bigint | string }>,
  opts: { rollupId: string; version: "v1" | "v2"; chainId?: string },
): WithdrawalsTree {
  if (withdrawals.length === 0) throw new Error("a withdrawals tree needs at least one withdrawal");
  const leaves = withdrawals.map((w, i) => {
    const input = { ...w, rollupId: opts.rollupId, withdrawalIndex: i };
    return opts.version === "v2"
      ? withdrawalLeafV2(opts.chainId ?? "", input)
      : withdrawalLeafV1(input);
  });
  const root = binaryMerkleRoot(leaves, CHAIN_TREE);
  return {
    root,
    leaves,
    proof: (withdrawalIndex: number) => assembleWithdrawalProof(leaves, withdrawalIndex),
  };
}

/** The proof material for a single withdrawal. */
export interface WithdrawalProof {
  /** Sibling hashes from the leaf to `withdrawals_root`, for the `proof` field. */
  proof: Uint8Array[];
  /** The computed `withdrawals_root` (compare against the batch's). */
  withdrawalsRoot: Uint8Array;
  /** The withdrawal's index within the batch. */
  withdrawalIndex: number;
}

/**
 * Assemble the Merkle proof for the withdrawal at `withdrawalIndex` from the full
 * list of the batch's withdrawal leaves (from {@link withdrawalLeafV1} /
 * {@link withdrawalLeafV2}). The defaults are the chain's tree; before 0.7.0
 * they re-hashed each leaf with SHA-256, which the chain does not do.
 */
export function assembleWithdrawalProof(
  leaves: Uint8Array[],
  withdrawalIndex: number,
  options: MerkleOptions = CHAIN_TREE,
): WithdrawalProof {
  const { siblings, root } = binaryMerkleProof(leaves, withdrawalIndex, options);
  return { proof: siblings, withdrawalsRoot: root, withdrawalIndex };
}

/**
 * Combine a withdrawal's recipient/amount details with an assembled proof into
 * the `ExecuteWithdrawalInput` for the tx client.
 */
export function buildExecuteWithdrawalInput(args: {
  submitter: string;
  rollupId: string;
  batchIndex: number | bigint;
  recipient: string;
  denom: string;
  amount: number | bigint | string;
  withdrawal: WithdrawalProof;
}): ExecuteWithdrawalInput {
  return {
    submitter: args.submitter,
    rollupId: args.rollupId,
    batchIndex: args.batchIndex,
    withdrawalIndex: args.withdrawal.withdrawalIndex,
    recipient: args.recipient,
    denom: args.denom,
    amount: args.amount,
    proof: args.withdrawal.proof,
  };
}
