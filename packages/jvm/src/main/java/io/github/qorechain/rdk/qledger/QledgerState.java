package io.github.qorechain.rdk.qledger;

/** What qledger-v1 execution reads and writes: a whole {@link QledgerLedger} or a {@link QledgerPartialTree}. */
public interface QledgerState {
    /** An account's balance and nonce (both uint64, read unsigned). */
    final class Account {
        public final long balance;
        public final long nonce;

        public Account(long balance, long nonce) {
            this.balance = balance;
            this.nonce = nonce;
        }
    }

    /** The account {@code id} (zero balance and nonce when it is not present). */
    Account get(byte[] id);

    /** Set an account; a zero account is the empty leaf. */
    void set(byte[] id, long balance, long nonce);

    /** The current state root. */
    byte[] root();
}
