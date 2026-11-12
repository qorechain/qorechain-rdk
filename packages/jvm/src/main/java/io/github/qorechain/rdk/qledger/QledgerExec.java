package io.github.qorechain.rdk.qledger;

import io.github.qorechain.rdk.util.Bech32;
import io.github.qorechain.rdk.util.Qorehash;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * qledger-v1 execution: what a batch's state root and withdrawals root must be for the inbox
 * entries it consumes. The chain re-runs exactly this in a fraud proof, so a submitter that
 * publishes anything else loses its bond.
 *
 * <p>Entries that do not parse, carry a bad signature, the wrong nonce, a zero amount, more than
 * the balance, or a non-canonical recipient are no-ops: an open inbox must accept anything without
 * making a batch invalid.
 */
public final class QledgerExec {
    private QledgerExec() {}

    /** The denom every qledger-v1 withdrawal pays. */
    public static final String WITHDRAWAL_DENOM = "uqor";

    private static final byte[] COUNTER_ID = QledgerTx.sha256(QledgerTx.utf8("qledger/v1/withdrawal-counter"));

    /**
     * The reserved state slot holding the rollup's next withdrawal index (in its balance).
     * Withdrawal indices are global to the rollup. Returns a fresh copy.
     */
    public static byte[] withdrawalCounterId() {
        return COUNTER_ID.clone();
    }

    /** Whether {@code s} is a {@code qor1} account address in canonical (lowercase, re-encoding) form. */
    public static boolean isCanonicalQorAddress(String s) {
        if (s == null) {
            return false;
        }
        try {
            Bech32.Decoded d = Bech32.decode(s);
            if (!"qor".equals(d.hrp)) {
                return false;
            }
            if (d.data.length == 0 || d.data.length > 255) {
                return false;
            }
            return Bech32.encode("qor", d.data).equals(s);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Apply {@code entries} to {@code state} in order and return the roots the batch must publish.
     *
     * @throws QledgerIncompleteWitnessException only when {@code state} cannot serve an account (a
     *     partial tree missing a witness)
     */
    public static QledgerResult execute(String chainId, String rollupId, QledgerState state, List<QledgerEntry> entries) {
        List<QledgerWithdrawal> withdrawals = new ArrayList<>();
        for (QledgerEntry e : entries) {
            if (e.poster.startsWith(QledgerTx.DEPOSIT_POSTER_PREFIX)) {
                QledgerTx.Deposit dep = QledgerTx.decodeDeposit(e.payload);
                if (dep == null || Arrays.equals(dep.account, COUNTER_ID)) {
                    continue;
                }
                QledgerState.Account a = state.get(dep.account);
                if (addOverflows(a.balance, dep.amount)) {
                    continue;
                }
                state.set(dep.account, a.balance + dep.amount, a.nonce);
                continue;
            }
            QledgerTx tx = QledgerTx.decode(e.payload);
            if (tx == null || !tx.verify(chainId, rollupId)) {
                continue;
            }
            byte[] from = QledgerTx.accountId(tx.publicKey, tx.scheme);
            QledgerState.Account fa = state.get(from);
            long balance = fa.balance;
            long nonce = fa.nonce;
            if (tx.nonce != nonce
                    || tx.amount == 0
                    || Long.compareUnsigned(balance, tx.amount) < 0
                    || nonce == -1L) {
                continue;
            }
            if (tx.kind == QledgerTx.KIND_TRANSFER) {
                byte[] to = tx.to;
                if (Arrays.equals(to, COUNTER_ID)) {
                    continue;
                }
                if (Arrays.equals(to, from)) {
                    state.set(from, balance, nonce + 1);
                    continue;
                }
                QledgerState.Account t = state.get(to);
                if (addOverflows(t.balance, tx.amount)) {
                    continue;
                }
                state.set(from, balance - tx.amount, nonce + 1);
                state.set(to, t.balance + tx.amount, t.nonce);
            } else if (tx.kind == QledgerTx.KIND_WITHDRAW) {
                // Amounts above the largest int64 are refused (the signed bit is set).
                if (tx.amount < 0 || !isCanonicalQorAddress(tx.recipient)) {
                    continue;
                }
                long next = state.get(COUNTER_ID).balance;
                if (next == -1L) {
                    continue;
                }
                state.set(from, balance - tx.amount, nonce + 1);
                state.set(COUNTER_ID, next + 1, 0);
                withdrawals.add(new QledgerWithdrawal(next, tx.recipient, tx.amount));
            }
        }
        return new QledgerResult(state.root(), withdrawals, withdrawalsRoot(chainId, rollupId, withdrawals));
    }

    /** Whether {@code a + b} exceeds the largest uint64. */
    private static boolean addOverflows(long a, long b) {
        return Long.compareUnsigned(a, -1L - b) > 0;
    }

    private static byte[] lp(byte[] b) {
        return ByteBuffer.allocate(4 + b.length).putInt(b.length).put(b).array();
    }

    /** The chain's v2 withdrawal leaf (SHAKE-256, every field length-prefixed). */
    public static byte[] withdrawalLeaf(String chainId, String rollupId, long index, String recipient, long amount) {
        return Qorehash.qorehash(
                lp(QledgerTx.utf8("qorechain-rdk-withdrawal/v2")),
                lp(QledgerTx.utf8(chainId)),
                lp(QledgerTx.utf8(rollupId)),
                QledgerTx.be64(index),
                lp(QledgerTx.utf8(recipient)),
                lp(QledgerTx.utf8(WITHDRAWAL_DENOM)),
                QledgerTx.be64(amount));
    }

    private static List<byte[][]> levels(String chainId, String rollupId, List<QledgerWithdrawal> ws) {
        if (ws.isEmpty()) {
            return null;
        }
        int n = 1;
        while (n < ws.size()) {
            n *= 2;
        }
        // Consecutive global indices: positions index mod n are distinct.
        byte[][] level = new byte[n][];
        for (int i = 0; i < n; i++) {
            level[i] = new byte[32];
        }
        for (QledgerWithdrawal w : ws) {
            level[(int) Long.remainderUnsigned(w.index, n)] =
                    withdrawalLeaf(chainId, rollupId, w.index, w.recipient, w.amount);
        }
        List<byte[][]> out = new ArrayList<>();
        out.add(level);
        while (level.length > 1) {
            byte[][] next = new byte[level.length / 2][];
            for (int i = 0; i < next.length; i++) {
                next[i] = Qorehash.qorehash(level[2 * i], level[2 * i + 1]);
            }
            out.add(next);
            level = next;
        }
        return out;
    }

    /**
     * A qledger-v1 batch's withdrawals root: its withdrawals in a tree of the next power of two,
     * each at its global index modulo that size, the rest zero; empty when there is none.
     */
    public static byte[] withdrawalsRoot(String chainId, String rollupId, List<QledgerWithdrawal> ws) {
        List<byte[][]> l = levels(chainId, rollupId, ws);
        return l == null ? new byte[0] : l.get(l.size() - 1)[0].clone();
    }

    /** The sibling path of withdrawal {@code i} of a batch, as {@code MsgExecuteWithdrawal} takes it. */
    public static List<byte[]> withdrawalProof(String chainId, String rollupId, List<QledgerWithdrawal> ws, int i) {
        List<byte[][]> l = levels(chainId, rollupId, ws);
        if (l == null || i < 0 || i >= ws.size()) {
            throw new IllegalArgumentException("qledger: no such withdrawal");
        }
        int idx = (int) Long.remainderUnsigned(ws.get(i).index, l.get(0).length);
        List<byte[]> path = new ArrayList<>();
        for (int k = 0; k < l.size() - 1; k++) {
            path.add(l.get(k)[idx ^ 1].clone());
            idx >>= 1;
        }
        return path;
    }
}
