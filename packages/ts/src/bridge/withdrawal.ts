/**
 * Withdrawal-proof assembly for `MsgExecuteWithdrawal`.
 *
 * A withdrawal is executed by proving its leaf is committed in a finalized
 * batch's `withdrawals_root`. This helper turns the batch's withdrawal leaves
 * into the sibling-hash proof the message carries. The leaf encoding and hashing
 * must match the network's construction — see {@link MerkleOptions}.
 */
import { binaryMerkleProof, type MerkleOptions } from "./merkle";
import type { ExecuteWithdrawalInput } from "../tx/messages";

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
 * list of the batch's withdrawal leaves.
 */
export function assembleWithdrawalProof(
  leaves: Uint8Array[],
  withdrawalIndex: number,
  options?: MerkleOptions,
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
