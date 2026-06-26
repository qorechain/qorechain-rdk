package io.github.qorechain.rdk.bridge;

import io.github.qorechain.rdk.bridge.Merkle.MerkleOptions;
import io.github.qorechain.rdk.bridge.Merkle.MerkleProof;
import io.github.qorechain.rdk.tx.Messages.ExecuteWithdrawalInput;
import java.util.List;

/**
 * Withdrawal-proof assembly for {@code MsgExecuteWithdrawal}.
 *
 * <p>A withdrawal is executed by proving its leaf is committed in a finalized batch's
 * {@code withdrawals_root}. This helper turns the batch's withdrawal leaves into the sibling-hash
 * proof the message carries. The leaf encoding and hashing must match the network's construction —
 * see {@link MerkleOptions}.
 */
public final class Withdrawal {
    private Withdrawal() {}

    /** The proof material for a single withdrawal. */
    public static final class WithdrawalProof {
        /** Sibling hashes from the leaf to {@code withdrawals_root}, for the {@code proof} field. */
        public final List<byte[]> proof;
        /** The computed {@code withdrawals_root} (compare against the batch's). */
        public final byte[] withdrawalsRoot;
        /** The withdrawal's index within the batch. */
        public final int withdrawalIndex;

        public WithdrawalProof(List<byte[]> proof, byte[] withdrawalsRoot, int withdrawalIndex) {
            this.proof = proof;
            this.withdrawalsRoot = withdrawalsRoot;
            this.withdrawalIndex = withdrawalIndex;
        }
    }

    /**
     * Assemble the Merkle proof for the withdrawal at {@code withdrawalIndex} from the full list of
     * the batch's withdrawal leaves.
     */
    public static WithdrawalProof assembleWithdrawalProof(
            List<byte[]> leaves, int withdrawalIndex, MerkleOptions options) {
        MerkleProof proof = Merkle.binaryMerkleProof(leaves, withdrawalIndex, options);
        return new WithdrawalProof(proof.siblings, proof.root, withdrawalIndex);
    }

    /**
     * Combine a withdrawal's recipient/amount details with an assembled proof into the
     * {@link ExecuteWithdrawalInput} for the tx client.
     */
    public static ExecuteWithdrawalInput buildExecuteWithdrawalInput(
            String submitter,
            String rollupId,
            long batchIndex,
            String recipient,
            String denom,
            long amount,
            WithdrawalProof withdrawal) {
        ExecuteWithdrawalInput in = new ExecuteWithdrawalInput();
        in.submitter = submitter;
        in.rollupId = rollupId;
        in.batchIndex = batchIndex;
        in.withdrawalIndex = withdrawal.withdrawalIndex;
        in.recipient = recipient;
        in.denom = denom;
        in.amount = amount;
        in.proof = withdrawal.proof;
        return in;
    }
}
