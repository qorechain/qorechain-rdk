package io.github.qorechain.rdk.bridge;

import io.github.qorechain.rdk.bridge.Merkle.MerkleOptions;
import io.github.qorechain.rdk.bridge.Merkle.MerkleProof;
import io.github.qorechain.rdk.transition.Transition;
import io.github.qorechain.rdk.tx.Messages.ExecuteWithdrawalInput;
import io.github.qorechain.rdk.util.Qorehash;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Withdrawal-proof assembly for {@code MsgExecuteWithdrawal}.
 *
 * <p>A withdrawal is executed by proving its leaf is committed in a finalized batch's
 * {@code withdrawals_root}. This helper turns the batch's withdrawal leaves into the sibling-hash
 * proof the message carries.
 *
 * <p>Use {@link #withdrawalsTree}: it builds the chain's own leaves and tree, so its root and
 * proofs are what {@code MsgExecuteWithdrawal} verifies (tested against the chain's {@code
 * VerifyWithdrawalMerkle}). The chain places each withdrawal at its index, hashes nodes as
 * SHAKE-256(left || right), and pairs an odd last node with itself. A batch submitted from chain
 * v3.2.5 ({@code rdk-withdrawals-binding}) commits v2 leaves, which also name the chain id; check
 * which with {@link Transition#versionForBatch}.
 */
public final class Withdrawal {
    private Withdrawal() {}

    /** One L2 to L1 withdrawal as the chain hashes it. */
    public static final class WithdrawalLeafInput {
        public String rollupId = "";
        /** The withdrawal's position in its batch; also its leaf position. */
        public long withdrawalIndex;
        public String recipient = "";
        public String denom = "";
        /** The amount, as the chain's unsigned 64-bit integer. */
        public long amount;

        public WithdrawalLeafInput() {}

        public WithdrawalLeafInput(
                String rollupId, long withdrawalIndex, String recipient, String denom, long amount) {
            this.rollupId = rollupId;
            this.withdrawalIndex = withdrawalIndex;
            this.recipient = recipient;
            this.denom = denom;
            this.amount = amount;
        }
    }

    /** One entry of a batch's withdrawals; its position in the list is its withdrawal index. */
    public static final class WithdrawalItem {
        public String recipient = "";
        public String denom = "";
        public long amount;

        public WithdrawalItem() {}

        public WithdrawalItem(String recipient, String denom, long amount) {
            this.recipient = recipient;
            this.denom = denom;
            this.amount = amount;
        }
    }

    private static final byte[] ZERO = {0};
    private static final byte[] V2_TAG = utf8("qorechain-rdk-withdrawal/v2");

    private static byte[] utf8(String s) {
        return (s == null ? "" : s).getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] u64be(long v) {
        return ByteBuffer.allocate(8).putLong(v).array();
    }

    private static byte[] lp(byte[] b) {
        return ByteBuffer.allocate(4 + b.length).putInt(b.length).put(b).array();
    }

    /**
     * The chain's original withdrawal leaf (every batch before {@code rdk-withdrawals-binding}):
     * {@code SHAKE-256(rollup_id || 0x00 || withdrawal_index(8B BE) || recipient || 0x00 || denom ||
     * 0x00 || amount(8B BE))}.
     */
    public static byte[] withdrawalLeafV1(WithdrawalLeafInput w) {
        return Qorehash.qorehash(
                utf8(w.rollupId),
                ZERO,
                u64be(w.withdrawalIndex),
                utf8(w.recipient),
                ZERO,
                utf8(w.denom),
                ZERO,
                u64be(w.amount));
    }

    /**
     * The v2 leaf of a batch bound under chain v3.2.5: the same fields, length-prefixed, behind a
     * tag and the chain id, so a withdrawal committed for one network has no valid proof on
     * another.
     */
    public static byte[] withdrawalLeafV2(String chainId, WithdrawalLeafInput w) {
        if (chainId == null || chainId.isEmpty()) {
            throw new IllegalArgumentException("a v2 withdrawal leaf names the chain id; pass it");
        }
        return Qorehash.qorehash(
                lp(V2_TAG),
                lp(utf8(chainId)),
                lp(utf8(w.rollupId)),
                u64be(w.withdrawalIndex),
                lp(utf8(w.recipient)),
                lp(utf8(w.denom)),
                u64be(w.amount));
    }

    /** The chain's tree over already-hashed leaves. */
    private static MerkleOptions chainTree() {
        MerkleOptions o = new MerkleOptions();
        o.hashLeaves = false;
        o.duplicateOdd = true;
        return o;
    }

    /** A batch's withdrawals, hashed and committed exactly as the chain does. */
    public static final class WithdrawalsTree {
        /** The batch's {@code withdrawals_root} (32 bytes). */
        public final byte[] root;
        /** The leaves, in withdrawal-index order. */
        public final List<byte[]> leaves;

        WithdrawalsTree(byte[] root, List<byte[]> leaves) {
            this.root = root;
            this.leaves = leaves;
        }

        /** The proof for the withdrawal at {@code withdrawalIndex}. */
        public WithdrawalProof proof(int withdrawalIndex) {
            return assembleWithdrawalProof(leaves, withdrawalIndex);
        }
    }

    /**
     * Build a batch's withdrawals tree. Withdrawal {@code i} of {@code withdrawals} is withdrawal
     * index {@code i}. {@code version} must be the binding the chain judges the batch by: {@code
     * V2} (with {@code chainId}) for a batch submitted from chain v3.2.5's {@code
     * rdk-withdrawals-binding}, {@code V1} before; {@code chainId} is ignored for {@code V1}.
     */
    public static WithdrawalsTree withdrawalsTree(
            List<WithdrawalItem> withdrawals,
            String rollupId,
            Transition.Version version,
            String chainId) {
        if (withdrawals == null || withdrawals.isEmpty()) {
            throw new IllegalArgumentException("a withdrawals tree needs at least one withdrawal");
        }
        List<byte[]> leaves = new ArrayList<>(withdrawals.size());
        for (int i = 0; i < withdrawals.size(); i++) {
            WithdrawalItem w = withdrawals.get(i);
            WithdrawalLeafInput input =
                    new WithdrawalLeafInput(rollupId, i, w.recipient, w.denom, w.amount);
            leaves.add(
                    version == Transition.Version.V2
                            ? withdrawalLeafV2(chainId, input)
                            : withdrawalLeafV1(input));
        }
        byte[] root = Merkle.binaryMerkleRoot(leaves, chainTree());
        return new WithdrawalsTree(root, Collections.unmodifiableList(leaves));
    }

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
     * the batch's withdrawal leaves (from {@link #withdrawalLeafV1} / {@link #withdrawalLeafV2}).
     * {@code null} options are the chain's tree; before 0.7.0 they re-hashed each leaf with
     * SHA-256, which the chain does not do. Pass a {@link MerkleOptions} to build another tree.
     */
    public static WithdrawalProof assembleWithdrawalProof(
            List<byte[]> leaves, int withdrawalIndex, MerkleOptions options) {
        MerkleProof proof =
                Merkle.binaryMerkleProof(
                        leaves, withdrawalIndex, options == null ? chainTree() : options);
        return new WithdrawalProof(proof.siblings, proof.root, withdrawalIndex);
    }

    /** {@link #assembleWithdrawalProof(List, int, MerkleOptions)} over the chain's tree. */
    public static WithdrawalProof assembleWithdrawalProof(List<byte[]> leaves, int withdrawalIndex) {
        return assembleWithdrawalProof(leaves, withdrawalIndex, null);
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
