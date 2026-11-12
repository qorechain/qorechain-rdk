package io.github.qorechain.rdk.qledger;

/** One inbox entry a qledger-v1 batch consumes. */
public final class QledgerEntry {
    /** The height of the block that included the post. */
    public final long height;
    /** The poster address, or {@code "deposit:" + depositor} for a deposit. */
    public final String poster;
    public final byte[] payload;

    public QledgerEntry(long height, String poster, byte[] payload) {
        this.height = height;
        this.poster = poster;
        this.payload = payload;
    }
}
