package io.github.qorechain.rdk.qledger;

import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * A whole qledger-v1 state in memory: what a submitter or a challenger keeps, and what builds
 * witnesses. Zero accounts are not stored, so the root is unique for a state.
 */
public final class QledgerLedger implements QledgerState {
    /** One stored account. */
    public static final class Entry {
        public final byte[] id;
        public final long balance;
        public final long nonce;

        Entry(byte[] id, long balance, long nonce) {
            this.id = id;
            this.balance = balance;
            this.nonce = nonce;
        }
    }

    // Keyed by lowercase hex, so iteration is in id order.
    private final TreeMap<String, Entry> accts = new TreeMap<>();

    @Override
    public Account get(byte[] id) {
        Entry a = accts.get(Bytes.bytesToHex(id));
        return a == null ? new Account(0, 0) : new Account(a.balance, a.nonce);
    }

    @Override
    public void set(byte[] id, long balance, long nonce) {
        String k = Bytes.bytesToHex(id);
        if (balance == 0 && nonce == 0) {
            accts.remove(k);
        } else {
            accts.put(k, new Entry(id.clone(), balance, nonce));
        }
    }

    /** An independent copy. */
    @Override
    public QledgerLedger clone() {
        QledgerLedger c = new QledgerLedger();
        for (Entry a : accts.values()) {
            c.set(a.id, a.balance, a.nonce);
        }
        return c;
    }

    /** Every non-zero account, sorted by id. */
    public List<Entry> accounts() {
        List<Entry> out = new ArrayList<>();
        for (Map.Entry<String, Entry> e : accts.entrySet()) {
            Entry a = e.getValue();
            out.add(new Entry(a.id.clone(), a.balance, a.nonce));
        }
        return Collections.unmodifiableList(out);
    }

    private List<byte[]> ids() {
        List<byte[]> out = new ArrayList<>();
        for (Entry a : accts.values()) {
            out.add(a.id);
        }
        return out;
    }

    private byte[] subtree(int d, List<byte[]> ids) {
        int depth = QledgerTree.DEPTH;
        if (ids.isEmpty()) {
            return QledgerTree.empty(depth - d);
        }
        if (ids.size() == 1) {
            byte[] id = ids.get(0);
            Account a = get(id);
            byte[] cur = QledgerTree.leafHash(id, a.balance, a.nonce);
            for (int dd = depth; dd > d; dd--) {
                byte[] e = QledgerTree.empty(depth - dd);
                cur = QledgerTree.bit(id, dd - 1) == 0 ? QledgerTree.hashNode(cur, e) : QledgerTree.hashNode(e, cur);
            }
            return cur;
        }
        List<byte[]> left = new ArrayList<>();
        List<byte[]> right = new ArrayList<>();
        for (byte[] id : ids) {
            (QledgerTree.bit(id, d) == 0 ? left : right).add(id);
        }
        return QledgerTree.hashNode(subtree(d + 1, left), subtree(d + 1, right));
    }

    @Override
    public byte[] root() {
        return subtree(0, ids()).clone();
    }

    /** A witness for {@code id} (present or not) against {@link #root}. */
    public QledgerWitness witness(byte[] id) {
        Account a = get(id);
        byte[] bitmap = new byte[32];
        List<Integer> depths = new ArrayList<>();
        List<byte[]> hashes = new ArrayList<>();
        List<byte[]> ids = ids();
        // Walk down from the root: at each depth d (1..256) the sibling of id's node is the
        // subtree on the other side of bit d-1.
        for (int d = 1; d <= QledgerTree.DEPTH; d++) {
            List<byte[]> same = new ArrayList<>();
            List<byte[]> other = new ArrayList<>();
            int b = QledgerTree.bit(id, d - 1);
            for (byte[] x : ids) {
                (QledgerTree.bit(x, d - 1) == b ? same : other).add(x);
            }
            if (!other.isEmpty()) {
                depths.add(d);
                hashes.add(subtree(d, other).clone());
            }
            ids = same;
        }
        List<byte[]> siblings = new ArrayList<>();
        for (int i = depths.size() - 1; i >= 0; i--) {
            int d = depths.get(i);
            bitmap[(d - 1) >> 3] |= (byte) (1 << (7 - ((d - 1) & 7)));
            siblings.add(hashes.get(i));
        }
        return new QledgerWitness(id.clone(), a.balance, a.nonce, bitmap, siblings);
    }
}
