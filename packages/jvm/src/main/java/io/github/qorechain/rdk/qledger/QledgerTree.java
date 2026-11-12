package io.github.qorechain.rdk.qledger;

import io.github.qorechain.rdk.util.Bytes;
import java.nio.charset.StandardCharsets;

/**
 * The qledger-v1 state tree: a sparse Merkle tree of depth 256 over account ids (SHA-256), one
 * level per bit, most significant bit first.
 *
 * <pre>
 * empty leaf = SHA-256(0x00 | "qledger/v1/empty")
 * leaf       = SHA-256(0x00 | id[32] | be64(balance) | be64(nonce))   (empty leaf when both are 0)
 * node       = SHA-256(0x01 | left | right)
 * </pre>
 *
 * <p>{@link QledgerLedger} holds a whole state; {@link QledgerPartialTree} the part a set of
 * witnesses opens.
 */
public final class QledgerTree {
    private QledgerTree() {}

    /** The tree depth: one level per bit of a 32-byte account id. */
    public static final int DEPTH = 256;

    private static final byte[][] EMPTY = new byte[DEPTH + 1][];

    static {
        byte[] tag = "qledger/v1/empty".getBytes(StandardCharsets.UTF_8);
        EMPTY[0] = QledgerTx.sha256(new byte[] {0x00}, tag);
        for (int h = 1; h <= DEPTH; h++) {
            EMPTY[h] = hashNode(EMPTY[h - 1], EMPTY[h - 1]);
        }
    }

    static byte[] hashNode(byte[] l, byte[] r) {
        return QledgerTx.sha256(new byte[] {0x01}, l, r);
    }

    /** The root of an empty subtree of height {@code h} (0 = the empty leaf), shared: do not modify. */
    static byte[] empty(int h) {
        return EMPTY[h];
    }

    /** The root of an empty subtree of height {@code h} (0 = the empty leaf). */
    public static byte[] emptyHash(int h) {
        return EMPTY[h].clone();
    }

    /** The state root of a ledger with no account: the parent root of a rollup's first batch. */
    public static byte[] emptyRoot() {
        return emptyHash(DEPTH);
    }

    /** The leaf of an account (the empty leaf for a zero account). */
    public static byte[] leafHash(byte[] id, long balance, long nonce) {
        if (balance == 0 && nonce == 0) {
            return EMPTY[0].clone();
        }
        return QledgerTx.sha256(new byte[] {0x00}, id, QledgerTx.be64(balance), QledgerTx.be64(nonce));
    }

    static int bit(byte[] id, int i) {
        return (id[i >> 3] >> (7 - (i & 7))) & 1;
    }

    static boolean bitmapBit(byte[] bitmap, int i) {
        return ((bitmap[i >> 3] >> (7 - (i & 7))) & 1) == 1;
    }

    /** The key of the node at depth {@code d} on {@code id}'s path. */
    static String keyOf(byte[] id, int d) {
        byte[] p = new byte[32];
        System.arraycopy(id, 0, p, 0, d >> 3);
        if ((d & 7) != 0) {
            p[d >> 3] = (byte) (id[d >> 3] & (0xff << (8 - (d & 7))));
        }
        return d + ":" + Bytes.bytesToHex(p);
    }

    /** The key of the sibling at depth {@code d} of {@code id}'s node. */
    static String sibKey(byte[] id, int d) {
        byte[] f = id.clone();
        f[(d - 1) >> 3] ^= (byte) (1 << (7 - ((d - 1) & 7)));
        return keyOf(f, d);
    }
}
