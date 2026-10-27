package io.github.qorechain.rdk.transition;

import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.util.Qorehash;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * The canonical batch transition root: the state root a protocol-following sequencer publishes
 * for a settlement batch.
 *
 * <p>The chain judges an optimistic batch by it. A fraud challenge is upheld when the batch's
 * published {@code state_root} differs from this root and the challenger names this root (see
 * {@link #fraudProof}); from chain v3.2.5 any account may resolve that challenge, and an upheld
 * one is paid from the rollup's escrow. A batch that publishes anything else, such as a
 * placeholder, is provably fraudulent. The test vectors come from the chain's own {@code
 * BatchTransitionRoot}.
 */
public final class Transition {

    /** The protocol feature that switches batches to the v2 binding. */
    public static final String FEATURE_RDK_WITHDRAWALS_BINDING = "rdk-withdrawals-binding";

    /** The chain upgrade that turns it on. */
    public static final String WITHDRAWALS_BINDING_UPGRADE = "v3.2.5";

    /**
     * The chain v3.2.5 protocol feature for in-order settlement: batches finalize in order, any
     * account may resolve a challenge, an upheld fraud rejects the later batches too, and a rollup
     * with an unsettled batch cannot be stopped.
     */
    public static final String FEATURE_RDK_CHALLENGE_SETTLEMENT = "rdk-challenge-settlement";

    /** Which transition binding a batch is judged by. */
    public enum Version {
        V1,
        V2
    }

    /** What the binding covers. {@code chainId}, {@code rollupId} and {@code withdrawalsRoot} are v2 only. */
    public static final class Input {
        public String chainId = "";
        public String rollupId = "";
        public byte[] prevStateRoot = new byte[0];
        public byte[] dataHash = new byte[0];
        public long txCount;
        public byte[] withdrawalsRoot = new byte[0];
    }

    private Transition() {}

    private static byte[] u64(long n) {
        return ByteBuffer.allocate(8).putLong(n).array();
    }

    private static void field(ByteArrayOutputStream out, byte[] b) {
        byte[] data = b == null ? new byte[0] : b;
        out.writeBytes(ByteBuffer.allocate(4).putInt(data.length).array());
        out.writeBytes(data);
    }

    private static byte[] orEmpty(byte[] b) {
        return b == null ? new byte[0] : b;
    }

    /**
     * The original binding, used for every batch before the chain's {@code
     * rdk-withdrawals-binding} switch: {@code SHAKE-256(prev_state_root || data_hash ||
     * tx_count(8B BE))}, 32 bytes.
     */
    public static byte[] rootV1(Input in) {
        ByteArrayOutputStream msg = new ByteArrayOutputStream();
        msg.writeBytes(orEmpty(in.prevStateRoot));
        msg.writeBytes(orEmpty(in.dataHash));
        msg.writeBytes(u64(in.txCount));
        return Qorehash.qorehash(msg.toByteArray());
    }

    /**
     * The v2 binding (chain v3.2.5, {@code rdk-withdrawals-binding}), which also covers the chain
     * id, the rollup id and the withdrawals root. Every variable-length field carries a 4-byte
     * big-endian length prefix.
     */
    public static byte[] rootV2(Input in) {
        if (in.chainId == null || in.chainId.isEmpty() || in.rollupId == null || in.rollupId.isEmpty()) {
            throw new IllegalArgumentException(
                    "the v2 transition root covers the chain id and the rollup id; pass both");
        }
        byte[] wr = orEmpty(in.withdrawalsRoot);
        if (wr.length != 0 && wr.length != 32) {
            throw new IllegalArgumentException(
                    "withdrawals root must be empty or 32 bytes, got " + wr.length);
        }
        ByteArrayOutputStream msg = new ByteArrayOutputStream();
        field(msg, "qorechain-rdk-transition/v2".getBytes(StandardCharsets.UTF_8));
        field(msg, in.chainId.getBytes(StandardCharsets.UTF_8));
        field(msg, in.rollupId.getBytes(StandardCharsets.UTF_8));
        field(msg, in.prevStateRoot);
        field(msg, in.dataHash);
        msg.writeBytes(u64(in.txCount));
        field(msg, wr);
        return Qorehash.qorehash(msg.toByteArray());
    }

    /** The transition root under {@code version}. */
    public static byte[] root(Input in, Version version) {
        return version == Version.V2 ? rootV2(in) : rootV1(in);
    }

    /**
     * Which binding a batch submitted now is judged by: V2 once the chain reports {@code
     * rdk-withdrawals-binding} enabled, V1 before. A batch keeps the binding it was submitted
     * under, so compute the root right before submitting.
     */
    public static Version versionFor(RestClient rest) {
        return rest.isProtocolFeatureEnabled(FEATURE_RDK_WITHDRAWALS_BINDING) ? Version.V2 : Version.V1;
    }

    /**
     * Which binding the chain judges an existing batch by. The chain decides once, at submission:
     * a batch is bound to V2 exactly when it was included at or above the height where {@link
     * #WITHDRAWALS_BINDING_UPGRADE} was applied (the upgrade block itself included). The batch's
     * own {@code withdrawalsBound} is used when the node serves it. Challenge only with the root
     * under this version: a fraud proof built on the other binding is dismissed and its bond
     * forfeited.
     */
    public static Version versionForBatch(RestClient rest, BatchView batch) {
        if (batch.withdrawalsBound) {
            return Version.V2;
        }
        long applied = rest.getAppliedPlanHeight(WITHDRAWALS_BINDING_UPGRADE);
        return applied > 0 && batch.submittedAt >= applied ? Version.V2 : Version.V1;
    }

    /** The fraud proof the chain's optimistic verifier reads: {@code prev(32) || correct(32)}. */
    public static byte[] fraudProof(byte[] prevStateRoot, byte[] correctStateRoot) {
        if (prevStateRoot == null || prevStateRoot.length != 32 || correctStateRoot == null
                || correctStateRoot.length != 32) {
            throw new IllegalArgumentException(
                    "a fraud proof needs a 32-byte previous root and a 32-byte correct root");
        }
        byte[] out = new byte[64];
        System.arraycopy(prevStateRoot, 0, out, 0, 32);
        System.arraycopy(correctStateRoot, 0, out, 32, 32);
        return out;
    }
}
