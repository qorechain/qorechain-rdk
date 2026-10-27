package io.github.qorechain.rdk.util;

import java.io.ByteArrayOutputStream;
import network.qorechain.pqc.Pqc;

/**
 * QoreChain's default hash: SHAKE-256 with a 32-byte output (the chain's {@code qorehash.Sum256}).
 * Merkle nodes, withdrawal leaves, DA blob commitments and transition roots all use it.
 */
public final class Qorehash {
    private Qorehash() {}

    /** The output length in bytes. */
    public static final int SIZE = 32;

    /** SHAKE-256 of the concatenation of {@code parts}, 32 bytes. */
    public static byte[] qorehash(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) {
            if (p != null) {
                out.writeBytes(p);
            }
        }
        return Pqc.shake256(out.toByteArray(), SIZE);
    }
}
