package io.github.qorechain.rdk.qledger;

/** Thrown when execution touches an account a {@link QledgerPartialTree} does not hold. */
public final class QledgerIncompleteWitnessException extends IllegalStateException {
    private static final long serialVersionUID = 1L;

    public QledgerIncompleteWitnessException() {
        super("qledger: the witness does not open an account the batch touches");
    }
}
