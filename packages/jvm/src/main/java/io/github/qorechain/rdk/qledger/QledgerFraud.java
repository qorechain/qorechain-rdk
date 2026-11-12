package io.github.qorechain.rdk.qledger;

import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.util.Bytes;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * qledger-v1 fraud proofs: the challenger's side ({@link #build}) and the chain's decision ({@link
 * #check}), so a watcher can decide a batch locally before paying.
 *
 * <pre>
 * "QLFP" | 0x01 | acc_from[32] | be16(n) | n x (be64(height) | be16(len) poster | be32(len) payload)
 * | be16(m) | m x (id[32] | be64(balance) | be64(nonce) | bitmap[32] | popcount(bitmap) x sibling[32])
 * </pre>
 */
public final class QledgerFraud {
    private QledgerFraud() {}

    /** Most inbox entries one qledger-v1 batch may consume. */
    public static final int MAX_BATCH_ENTRIES = 64;
    /** Largest post a qledger-v1 rollup accepts. */
    public static final int MAX_POST_BYTES = 6 * 1024;

    private static final int MAX_WITNESSES = 2 * MAX_BATCH_ENTRIES;
    private static final int MAX_POSTER_LEN = 256;
    private static final byte[] MAGIC = "QLFP".getBytes(StandardCharsets.US_ASCII);

    /** A decoded fraud proof. */
    public static final class FraudProof {
        public final byte[] accFrom;
        public final List<QledgerEntry> entries;
        public final List<QledgerWitness> witnesses;

        public FraudProof(byte[] accFrom, List<QledgerEntry> entries, List<QledgerWitness> witnesses) {
            this.accFrom = accFrom;
            this.entries = entries;
            this.witnesses = witnesses;
        }
    }

    /** The encoded proof and the result an honest batch would have published. */
    public static final class Built {
        public final byte[] proof;
        public final QledgerResult honest;

        Built(byte[] proof, QledgerResult honest) {
            this.proof = proof;
            this.honest = honest;
        }
    }

    /** What a qledger-v1 batch published. Inbox positions are uint64, read unsigned. */
    public static final class Claim {
        public long inboxStart;
        public long inboxEnd;
        public byte[] dataHash;
        public byte[] prevStateRoot;
        public byte[] stateRoot;
        public byte[] withdrawalsRoot;

        public Claim() {}

        public Claim(
                long inboxStart,
                long inboxEnd,
                byte[] dataHash,
                byte[] prevStateRoot,
                byte[] stateRoot,
                byte[] withdrawalsRoot) {
            this.inboxStart = inboxStart;
            this.inboxEnd = inboxEnd;
            this.dataHash = dataHash;
            this.prevStateRoot = prevStateRoot;
            this.stateRoot = stateRoot;
            this.withdrawalsRoot = withdrawalsRoot;
        }
    }

    /** The proof's wire form. */
    public static byte[] encode(FraudProof p) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(MAGIC);
        out.write(1);
        out.writeBytes(p.accFrom);
        writeU16(out, p.entries.size());
        for (QledgerEntry e : p.entries) {
            byte[] poster = e.poster.getBytes(StandardCharsets.UTF_8);
            out.writeBytes(QledgerTx.be64(e.height));
            writeU16(out, poster.length);
            out.writeBytes(poster);
            out.writeBytes(QledgerTx.u32(e.payload.length));
            out.writeBytes(e.payload);
        }
        writeU16(out, p.witnesses.size());
        for (QledgerWitness w : p.witnesses) {
            out.writeBytes(w.id);
            out.writeBytes(QledgerTx.be64(w.balance));
            out.writeBytes(QledgerTx.be64(w.nonce));
            out.writeBytes(w.bitmap);
            for (byte[] s : w.siblings) {
                out.writeBytes(s);
            }
        }
        return out.toByteArray();
    }

    private static void writeU16(ByteArrayOutputStream out, int v) {
        out.write((v >>> 8) & 0xff);
        out.write(v & 0xff);
    }

    private static final class Reader {
        private final byte[] b;
        private int p;

        Reader(byte[] b) {
            this.b = b;
        }

        byte[] take(int n) {
            if (n < 0 || b.length - p < n) {
                throw malformed();
            }
            byte[] out = Arrays.copyOfRange(b, p, p + n);
            p += n;
            return out;
        }

        int u16() {
            byte[] x = take(2);
            return ((x[0] & 0xff) << 8) | (x[1] & 0xff);
        }

        long u32() {
            return ByteBuffer.wrap(take(4)).getInt() & 0xffffffffL;
        }

        long u64() {
            return ByteBuffer.wrap(take(8)).getLong();
        }
    }

    private static IllegalArgumentException malformed() {
        return new IllegalArgumentException("qledger: malformed fraud proof");
    }

    /**
     * Parse a proof.
     *
     * @throws IllegalArgumentException when it is malformed
     */
    public static FraudProof decode(byte[] input) {
        Reader r = new Reader(input == null ? new byte[0] : input);
        byte[] head = r.take(5);
        for (int i = 0; i < 4; i++) {
            if (head[i] != MAGIC[i]) {
                throw malformed();
            }
        }
        if (head[4] != 1) {
            throw malformed();
        }
        byte[] accFrom = r.take(32);
        int n = r.u16();
        if (n > MAX_BATCH_ENTRIES) {
            throw malformed();
        }
        List<QledgerEntry> entries = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            long height = r.u64();
            int pl = r.u16();
            if (pl > MAX_POSTER_LEN) {
                throw malformed();
            }
            String poster = new String(r.take(pl), StandardCharsets.UTF_8);
            long ln = r.u32();
            if (ln > MAX_POST_BYTES) {
                throw malformed();
            }
            entries.add(new QledgerEntry(height, poster, r.take((int) ln)));
        }
        int m = r.u16();
        if (m > MAX_WITNESSES) {
            throw malformed();
        }
        List<QledgerWitness> witnesses = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            byte[] id = r.take(32);
            long balance = r.u64();
            long nonce = r.u64();
            byte[] bitmap = r.take(32);
            int cnt = 0;
            for (byte x : bitmap) {
                cnt += Integer.bitCount(x & 0xff);
            }
            List<byte[]> siblings = new ArrayList<>();
            for (int j = 0; j < cnt; j++) {
                siblings.add(r.take(32));
            }
            witnesses.add(new QledgerWitness(id, balance, nonce, bitmap, siblings));
        }
        if (r.p != r.b.length) {
            throw malformed();
        }
        return new FraudProof(accFrom, entries, witnesses);
    }

    /** Records every account an execution touches, in first-touch order. */
    private static final class Recorder implements QledgerState {
        final List<byte[]> order = new ArrayList<>();
        private final Set<String> seen = new HashSet<>();
        private final QledgerState inner;

        Recorder(QledgerState inner) {
            this.inner = inner;
        }

        private void note(byte[] id) {
            if (seen.add(Bytes.bytesToHex(id))) {
                order.add(id.clone());
            }
        }

        @Override
        public Account get(byte[] id) {
            note(id);
            return inner.get(id);
        }

        @Override
        public void set(byte[] id, long balance, long nonce) {
            note(id);
            inner.set(id, balance, nonce);
        }

        @Override
        public byte[] root() {
            return inner.root();
        }
    }

    /**
     * The challenger's side: from the batch's parent state, the inbox accumulator at the batch's
     * start and the entries it consumed, the encoded proof to send with {@code challengeBatch}, and
     * the result an honest batch would have published. {@code parent} is not modified.
     */
    public static Built build(
            String chainId, String rollupId, QledgerLedger parent, byte[] accFrom, List<QledgerEntry> entries) {
        Recorder rec = new Recorder(parent.clone());
        QledgerResult honest = QledgerExec.execute(chainId, rollupId, rec, entries);
        List<QledgerWitness> witnesses = new ArrayList<>();
        for (byte[] id : rec.order) {
            witnesses.add(parent.witness(id));
        }
        byte[] acc = accFrom == null || accFrom.length == 0 ? Inbox.emptyInboxAcc() : accFrom;
        return new Built(encode(new FraudProof(acc, entries, witnesses)), honest);
    }

    private static IllegalArgumentException notApplicable(String why) {
        return new IllegalArgumentException("qledger: the fraud proof does not apply: " + why);
    }

    /**
     * Decide a fraud proof as the chain does: {@code true} when re-executing the batch's inputs
     * from its parent state gives a different state or withdrawals root than it published, {@code
     * false} when the batch is right.
     *
     * @throws IllegalArgumentException when the proof cannot decide (malformed, not about this
     *     batch, a witness that does not match the parent root): the chain refuses such a challenge
     * @throws QledgerIncompleteWitnessException when the witnesses do not open an account the batch
     *     touches (also refused by the chain)
     */
    public static boolean check(String chainId, String rollupId, Claim claim, byte[] proof) {
        FraudProof p = decode(proof);
        long start = claim.inboxStart;
        long end = claim.inboxEnd;
        if (Long.compareUnsigned(end, start) < 0 || (long) p.entries.size() != end - start) {
            throw notApplicable(
                    p.entries.size()
                            + " entries for inbox range "
                            + Long.toUnsignedString(start)
                            + ".."
                            + Long.toUnsignedString(end));
        }
        byte[] acc = p.accFrom;
        for (int i = 0; i < p.entries.size(); i++) {
            QledgerEntry e = p.entries.get(i);
            acc =
                    Inbox.inboxAccumulate(
                            chainId, rollupId, acc, start + i + 1, e.height, e.poster, Inbox.postedDataHash(e.payload));
        }
        byte[] want = Inbox.inboxRangeHash(chainId, rollupId, start, end, p.accFrom, acc);
        if (!Arrays.equals(want, claim.dataHash)) {
            throw notApplicable("the entries do not hash to the batch's inbox range");
        }
        if (claim.prevStateRoot == null || claim.prevStateRoot.length != 32) {
            throw notApplicable("the batch has no 32-byte parent root");
        }
        QledgerResult res =
                QledgerExec.execute(
                        chainId, rollupId, new QledgerPartialTree(claim.prevStateRoot, p.witnesses), p.entries);
        return !Arrays.equals(res.stateRoot, claim.stateRoot)
                || !Arrays.equals(res.withdrawalsRoot, orEmpty(claim.withdrawalsRoot));
    }

    private static byte[] orEmpty(byte[] b) {
        return b == null ? new byte[0] : b;
    }
}
