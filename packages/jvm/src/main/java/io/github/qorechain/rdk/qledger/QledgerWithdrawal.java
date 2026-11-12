package io.github.qorechain.rdk.qledger;

/** One withdrawal a qledger-v1 batch commits, at its global index. */
public final class QledgerWithdrawal {
    /** uint64, read unsigned. Indices are global to the rollup. */
    public final long index;
    public final String recipient;
    /** uqor; uint64, read unsigned. */
    public final long amount;

    public QledgerWithdrawal(long index, String recipient, long amount) {
        this.index = index;
        this.recipient = recipient;
        this.amount = amount;
    }
}
