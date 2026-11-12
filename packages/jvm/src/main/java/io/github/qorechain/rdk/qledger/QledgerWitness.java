package io.github.qorechain.rdk.qledger;

import java.util.ArrayList;
import java.util.List;

/**
 * Opens one account against a qledger-v1 state root. {@code siblings} run leaf to root, only the
 * non-empty ones, flagged in {@code bitmap} (bit {@code d-1} for depth {@code d}, most significant
 * bit first).
 */
public final class QledgerWitness {
    public final byte[] id;
    /** uint64, read unsigned. */
    public final long balance;
    /** uint64, read unsigned. */
    public final long nonce;
    /** 32 bytes. */
    public final byte[] bitmap;
    public final List<byte[]> siblings;

    public QledgerWitness(byte[] id, long balance, long nonce, byte[] bitmap, List<byte[]> siblings) {
        this.id = id;
        this.balance = balance;
        this.nonce = nonce;
        this.bitmap = bitmap;
        this.siblings = siblings == null ? new ArrayList<>() : siblings;
    }
}
