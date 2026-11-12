package io.github.qorechain.rdk.qledger;

import io.github.qorechain.rdk.util.Bytes;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * The part of a qledger-v1 state tree a set of witnesses opens, checked against a root (what the
 * chain builds from a fraud proof). Reading an account outside it throws {@link
 * QledgerIncompleteWitnessException}.
 */
public final class QledgerPartialTree implements QledgerState {
    private final Map<String, byte[]> nodes = new HashMap<>();
    private final Map<String, Account> accts = new HashMap<>();
    private byte[] current;

    /**
     * Check every witness against {@code root} and keep what they open.
     *
     * @throws IllegalArgumentException when a witness does not match the root
     */
    public QledgerPartialTree(byte[] root, Iterable<QledgerWitness> witnesses) {
        this.current = root.clone();
        int depth = QledgerTree.DEPTH;
        for (QledgerWitness w : witnesses) {
            byte[] cur = QledgerTree.leafHash(w.id, w.balance, w.nonce);
            put(QledgerTree.keyOf(w.id, depth), cur);
            int si = 0;
            for (int d = depth; d >= 1; d--) {
                byte[] sib = QledgerTree.empty(depth - d);
                if (QledgerTree.bitmapBit(w.bitmap, d - 1)) {
                    if (si >= w.siblings.size()) {
                        throw mismatch();
                    }
                    sib = w.siblings.get(si++);
                }
                put(QledgerTree.sibKey(w.id, d), sib);
                cur = QledgerTree.bit(w.id, d - 1) == 0 ? QledgerTree.hashNode(cur, sib) : QledgerTree.hashNode(sib, cur);
                put(QledgerTree.keyOf(w.id, d - 1), cur);
            }
            if (si != w.siblings.size() || !Arrays.equals(cur, root)) {
                throw mismatch();
            }
            accts.put(Bytes.bytesToHex(w.id), new Account(w.balance, w.nonce));
        }
    }

    private static IllegalArgumentException mismatch() {
        return new IllegalArgumentException("qledger: witness does not match the state root");
    }

    private void put(String k, byte[] v) {
        byte[] old = nodes.get(k);
        if (old != null && !Arrays.equals(old, v)) {
            throw mismatch();
        }
        nodes.put(k, v.clone());
    }

    @Override
    public Account get(byte[] id) {
        Account a = accts.get(Bytes.bytesToHex(id));
        if (a == null) {
            throw new QledgerIncompleteWitnessException();
        }
        return a;
    }

    @Override
    public void set(byte[] id, long balance, long nonce) {
        String k = Bytes.bytesToHex(id);
        if (!accts.containsKey(k)) {
            throw new QledgerIncompleteWitnessException();
        }
        accts.put(k, new Account(balance, nonce));
        int depth = QledgerTree.DEPTH;
        byte[] cur = QledgerTree.leafHash(id, balance, nonce);
        nodes.put(QledgerTree.keyOf(id, depth), cur);
        for (int d = depth; d >= 1; d--) {
            byte[] sib = nodes.get(QledgerTree.sibKey(id, d));
            if (sib == null) {
                throw new QledgerIncompleteWitnessException();
            }
            cur = QledgerTree.bit(id, d - 1) == 0 ? QledgerTree.hashNode(cur, sib) : QledgerTree.hashNode(sib, cur);
            nodes.put(QledgerTree.keyOf(id, d - 1), cur);
        }
        current = cur;
    }

    @Override
    public byte[] root() {
        return current.clone();
    }
}
