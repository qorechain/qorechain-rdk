package io.github.qorechain.rdk.qledger;

import java.util.List;

/** What a qledger-v1 batch must publish. */
public final class QledgerResult {
    public final byte[] stateRoot;
    public final List<QledgerWithdrawal> withdrawals;
    /** Empty when the batch has no withdrawal. */
    public final byte[] withdrawalsRoot;

    public QledgerResult(byte[] stateRoot, List<QledgerWithdrawal> withdrawals, byte[] withdrawalsRoot) {
        this.stateRoot = stateRoot;
        this.withdrawals = withdrawals;
        this.withdrawalsRoot = withdrawalsRoot;
    }
}
