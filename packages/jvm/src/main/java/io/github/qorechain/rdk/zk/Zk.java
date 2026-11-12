package io.github.qorechain.rdk.zk;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;

/**
 * ZK public inputs as the chain checks them (chain v3.2.8+, {@code rdk-zk-canonical-inputs}).
 *
 * <p>A Groth16 batch is verified with four public inputs, in order: {@code prev_state_root},
 * {@code state_root}, {@code data_hash}, {@code withdrawals_root}, each read as a 32-byte
 * big-endian integer. From v3.2.8 the chain no longer reduces a submitter-chosen input into the
 * BLS12-381 scalar field: it refuses the batch unless the value is already below the scalar modulus
 * {@code r}. A raw SHA-256 or SHAKE-256 output is at or above {@code r} about 55% of the time.
 *
 * <ul>
 *   <li>{@code prev_state_root} and {@code state_root} are always checked. Commit to state with a
 *       field-friendly hash, or reduce with {@link #toCanonicalScalar} and prove the reduced value.
 *   <li>{@code data_hash} is not checked when the chain fixed it itself: a based rollup's inbox
 *       range commitment, or a native-DA batch whose hash names a posted or stored blob ({@link
 *       #isDataHashChainBound}). Otherwise it must be canonical.
 *   <li>{@code withdrawals_root} may be any 32 bytes: the chain stores it reduced modulo {@code r}
 *       and checks withdrawals against it modulo {@code r} ({@link #withdrawalsRootMatches}). The
 *       circuit's fourth input is {@code int(withdrawals_root) mod r} ({@link #zkPublicInputs}).
 * </ul>
 */
public final class Zk {
    private Zk() {}

    /** The BLS12-381 scalar field modulus {@code r}. */
    public static final BigInteger BLS12_381_SCALAR_MODULUS =
            new BigInteger("73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001", 16);

    private static BigInteger toBigInteger(byte[] value) {
        return value == null || value.length == 0 ? BigInteger.ZERO : new BigInteger(1, value);
    }

    /** Whether a big-endian value is a canonical BLS12-381 scalar (strictly below {@code r}). */
    public static boolean isCanonicalScalar(byte[] value) {
        return toBigInteger(value).compareTo(BLS12_381_SCALAR_MODULUS) < 0;
    }

    /**
     * Reduce a big-endian value modulo {@code r} and return it as 32 big-endian bytes. Use it for
     * values the rollup chooses (state roots, an unbound data hash), and prove the reduced value in
     * the circuit.
     */
    public static byte[] toCanonicalScalar(byte[] value) {
        byte[] x = toBigInteger(value).mod(BLS12_381_SCALAR_MODULUS).toByteArray();
        byte[] out = new byte[32];
        // toByteArray may carry a leading sign byte; keep the low 32 bytes.
        int n = Math.min(x.length, 32);
        System.arraycopy(x, x.length - n, out, 32 - n, n);
        return out;
    }

    /** The public inputs of a zk batch, as they go into {@code MsgSubmitBatch}. {@code null} is not checked. */
    public static final class ZkBatchInputs {
        public byte[] prevStateRoot;
        public byte[] stateRoot;
        public byte[] dataHash;
        public byte[] withdrawalsRoot;

        public ZkBatchInputs() {}

        public ZkBatchInputs(byte[] prevStateRoot, byte[] stateRoot, byte[] dataHash, byte[] withdrawalsRoot) {
            this.prevStateRoot = prevStateRoot;
            this.stateRoot = stateRoot;
            this.dataHash = dataHash;
            this.withdrawalsRoot = withdrawalsRoot;
        }
    }

    /**
     * Why the chain would refuse a zk (snark) batch's public inputs as not canonical, one message
     * per input; empty when they are all accepted.
     *
     * @param dataHashBound the chain fixed {@code data_hash} itself (see {@link
     *     #isDataHashChainBound}), so it is not checked.
     */
    public static List<String> zkPublicInputErrors(ZkBatchInputs inputs, boolean dataHashBound) {
        List<String> names = new ArrayList<>();
        List<byte[]> values = new ArrayList<>();
        names.add("prev_state_root");
        values.add(inputs.prevStateRoot);
        names.add("state_root");
        values.add(inputs.stateRoot);
        if (!dataHashBound) {
            names.add("data_hash");
            values.add(inputs.dataHash);
        }
        // withdrawals_root is not checked: the chain reduces it modulo r.
        List<String> errors = new ArrayList<>();
        for (int i = 0; i < names.size(); i++) {
            byte[] v = values.get(i);
            if (v == null || isCanonicalScalar(v)) {
                continue;
            }
            errors.add(
                    names.get(i)
                            + " is not a canonical BLS12-381 scalar (it must be below r): reduce it with"
                            + " toCanonicalScalar and prove the reduced value");
        }
        return errors;
    }

    /** {@link #zkPublicInputErrors(ZkBatchInputs, boolean)} with {@code data_hash} checked. */
    public static List<String> zkPublicInputErrors(ZkBatchInputs inputs) {
        return zkPublicInputErrors(inputs, false);
    }

    /**
     * The four public inputs of a Groth16 rollup circuit, in the chain's order ({@code
     * prev_state_root}, {@code state_root}, {@code data_hash}, {@code withdrawals_root}), each the
     * 32-byte big-endian value reduced modulo {@code r}. An empty or {@code null} value is 0. Use
     * them as the circuit's public witness.
     */
    public static List<byte[]> zkPublicInputs(ZkBatchInputs inputs) {
        List<byte[]> out = new ArrayList<>();
        for (byte[] v :
                new byte[][] {inputs.prevStateRoot, inputs.stateRoot, inputs.dataHash, inputs.withdrawalsRoot}) {
            out.add(toCanonicalScalar(v));
        }
        return out;
    }

    /**
     * Whether a withdrawals tree root matches a batch's stored root, as the chain checks a
     * withdrawal: modulo {@code r} when the batch's {@code withdrawalsRootReduced} is set (chain
     * v3.2.8+ Groth16 batches), byte for byte otherwise.
     */
    public static boolean withdrawalsRootMatches(byte[] storedRoot, byte[] treeRoot, boolean withdrawalsRootReduced) {
        if (withdrawalsRootReduced) {
            return toBigInteger(storedRoot)
                    .mod(BLS12_381_SCALAR_MODULUS)
                    .equals(toBigInteger(treeRoot).mod(BLS12_381_SCALAR_MODULUS));
        }
        return java.util.Arrays.equals(
                storedRoot == null ? new byte[0] : storedRoot, treeRoot == null ? new byte[0] : treeRoot);
    }

    /**
     * Whether the chain fixes a batch's {@code data_hash} itself, so it is exempt from the
     * canonical check: always on a based rollup (the inbox range commitment), and on a {@code
     * native} or {@code both} DA rollup when the hash is non-empty (the chain then requires a posted
     * or stored blob with exactly that hash).
     */
    public static boolean isDataHashChainBound(String daBackend, String sequencing, byte[] dataHash) {
        if ("based".equals(sequencing)) {
            return true;
        }
        boolean nonEmpty = dataHash != null && dataHash.length > 0;
        return nonEmpty && ("native".equals(daBackend) || "both".equals(daBackend));
    }
}
