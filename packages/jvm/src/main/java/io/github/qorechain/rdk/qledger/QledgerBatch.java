package io.github.qorechain.rdk.qledger;

import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.InboxView;
import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.client.Views.RollupView;
import io.github.qorechain.rdk.client.Views.SubmitterBondView;
import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.config.Enums;
import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.tx.Messages.SubmitBatchInput;
import io.github.qorechain.rdk.util.Bytes;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongPredicate;

/**
 * Building qledger-v1 batches by the chain's admission rules (chain v3.2.8).
 *
 * <p>A qledger-v1 batch with {@code inbox_end = end} is admitted when:
 *
 * <ol>
 *   <li>the submitter holds at least {@code min_submitter_bond} on the rollup and has fewer than
 *       1,024 of its batches waiting for finality;
 *   <li>{@code consumed < end <= head} (at least one entry);
 *   <li>{@code end - consumed <= 64};
 *   <li>{@code end} is the head, or the commitment of post {@code end} is retained;
 *   <li>a batch of fewer than 64 entries that stops before the head stops just before a post made
 *       in the last 20 blocks, or at a checkpoint ({@code end} a multiple of 64) whose next post is
 *       no longer retained;
 *   <li>{@code data_hash} is the inbox range commitment from {@code consumed} to {@code end}, the
 *       first batch starts from the empty ledger root, and {@code state_root} is 32 bytes.
 * </ol>
 *
 * <p>Inbox sequences are uint64 values carried in a {@code long} and read unsigned.
 */
public final class QledgerBatch {
    private QledgerBatch() {}

    /** A post younger than this many blocks may be left for the next batch. */
    public static final int FRESH_POST_BLOCKS = 20;
    /** Most batches one submitter may have waiting for finality on a rollup. */
    public static final int MAX_PENDING_BATCHES_PER_SUBMITTER = 1024;
    /**
     * Every post whose sequence is a multiple of this keeps its commitment until a finalized batch
     * covers it.
     */
    public static final int CHECKPOINT_INTERVAL = 64;
    /** Share of a slashed submitter bond that is burned (the challenger receives the rest). */
    public static final int SLASH_BURN_PERCENT = 50;

    /** Whether {@code sequence} is a qledger-v1 checkpoint (a non-zero multiple of 64). */
    public static boolean isCheckpoint(long sequence) {
        return sequence != 0 && Long.remainderUnsigned(sequence, CHECKPOINT_INTERVAL) == 0;
    }

    /** What the admission rules need to know about the inbox and the submitter. */
    public static final class BatchFacts {
        public long consumed;
        public long head;
        public long end;
        /** The submitter's bond, uqor. */
        public BigInteger bond = BigInteger.ZERO;
        /** {@code min_submitter_bond}, uqor. */
        public BigInteger minBond = BigInteger.valueOf(Constants.DEFAULT_MIN_SUBMITTER_BOND_UQOR);
        /** The submitter's batches waiting for finality. */
        public long pending;
        /** Whether the commitment of post {@code end} is retained (ignored when {@code end} is the head). */
        public boolean endRetained;
        /**
         * Whether the commitment of post {@code end + 1} is retained (needed when {@code end} is
         * before the head), or {@code null} when unknown.
         */
        public Boolean nextRetained;
        /** Height of post {@code end + 1}, when retained; {@code null} when unknown. */
        public Long nextHeight;
        /**
         * The height the batch is expected to be included at, or {@code null}. The chain judges the
         * 20-block rule at inclusion, so pass the current height plus a margin for the time the
         * transaction takes to land.
         */
        public Long inclusionHeight;

        public BatchFacts() {}

        public BatchFacts(long consumed, long head, long end) {
            this.consumed = consumed;
            this.head = head;
            this.end = end;
        }
    }

    private static String u(long v) {
        return Long.toUnsignedString(v);
    }

    /** Every rule the batch range would break; empty when the chain admits it. */
    public static List<String> batchErrors(BatchFacts f) {
        List<String> errors = new ArrayList<>();
        BigInteger bond = f.bond == null ? BigInteger.ZERO : f.bond;
        BigInteger minBond =
                f.minBond == null ? BigInteger.valueOf(Constants.DEFAULT_MIN_SUBMITTER_BOND_UQOR) : f.minBond;
        if (bond.compareTo(minBond) < 0) {
            errors.add("the submitter holds " + bond + " uqor of bond, at least " + minBond + " is needed");
        }
        if (Long.compareUnsigned(f.pending, MAX_PENDING_BATCHES_PER_SUBMITTER) >= 0) {
            errors.add(
                    "the submitter already has "
                            + u(f.pending)
                            + " batches waiting for finality, at most "
                            + MAX_PENDING_BATCHES_PER_SUBMITTER);
        }
        long consumed = f.consumed;
        long head = f.head;
        long end = f.end;
        if (Long.compareUnsigned(end, consumed) <= 0) {
            errors.add(
                    "a batch consumes at least one inbox entry (consumed " + u(consumed) + ", inbox_end " + u(end) + ")");
            return errors;
        }
        if (Long.compareUnsigned(end, head) > 0) {
            errors.add("inbox_end " + u(end) + " is past the head " + u(head));
        }
        long n = end - consumed;
        boolean beforeHead = Long.compareUnsigned(end, head) < 0;
        if (Long.compareUnsigned(n, QledgerFraud.MAX_BATCH_ENTRIES) > 0) {
            errors.add(
                    "a batch consumes at most " + QledgerFraud.MAX_BATCH_ENTRIES + " inbox entries, this one " + u(n));
        }
        if (beforeHead && !f.endRetained) {
            errors.add(
                    "the commitment of post "
                            + u(end)
                            + " is no longer retained: end the batch at the head or at a retained post");
        }
        if (Long.compareUnsigned(n, QledgerFraud.MAX_BATCH_ENTRIES) < 0 && beforeHead) {
            boolean checkpointStop = isCheckpoint(end) && Boolean.FALSE.equals(f.nextRetained);
            boolean freshStop =
                    !Boolean.FALSE.equals(f.nextRetained)
                            && f.nextHeight != null
                            && f.inclusionHeight != null
                            && f.nextHeight + FRESH_POST_BLOCKS > f.inclusionHeight;
            if (!checkpointStop && !freshStop) {
                errors.add(
                        "a batch of fewer than "
                                + QledgerFraud.MAX_BATCH_ENTRIES
                                + " entries consumes every post older than "
                                + FRESH_POST_BLOCKS
                                + " blocks: post "
                                + u(end + 1)
                                + " must be in it");
            }
        }
        return errors;
    }

    /**
     * The {@code end} a submitter should choose (the chain's recommended logic): a full batch of 64
     * or the head when that position is retained, otherwise the next checkpoint (after a long idle
     * period, when only checkpoints kept their commitments). {@code null} when nothing is waiting.
     *
     * @param retained whether the commitment of post {@code x} is retained ({@code
     *     rest.getInbox(rollup, x).rangeDataHash} non-empty)
     */
    public static Long chooseBatchEnd(long consumed, long head, LongPredicate retained) {
        if (Long.compareUnsigned(head, consumed) <= 0) {
            return null;
        }
        long max = QledgerFraud.MAX_BATCH_ENTRIES;
        long want = Long.compareUnsigned(head - consumed, max) < 0 ? head : consumed + max;
        if (want == head || retained.test(want)) {
            return want;
        }
        return (Long.divideUnsigned(consumed, CHECKPOINT_INTERVAL) + 1) * CHECKPOINT_INTERVAL;
    }

    private static Map<String, String> attrs(Map<String, Object> ev) {
        Map<String, String> out = new LinkedHashMap<>();
        Object list = ev.get("attributes");
        if (list instanceof List) {
            for (Object o : (List<?>) list) {
                if (o instanceof Map) {
                    Map<?, ?> a = (Map<?, ?>) o;
                    Object v = a.get("value");
                    out.put(String.valueOf(a.get("key")), v == null ? "" : String.valueOf(v));
                }
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> rec(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>) o : new ArrayList<>();
    }

    private static long parseU64(String s) {
        if (s == null || s.isEmpty()) {
            return 0;
        }
        try {
            return Long.parseUnsignedLong(s);
        } catch (NumberFormatException e) {
            throw new IllegalStateException("qledger: the node served a malformed number \"" + s + "\"", e);
        }
    }

    private static String str(Object o) {
        if (o == null) {
            return "";
        }
        if (o instanceof Number) {
            return Long.toString(((Number) o).longValue());
        }
        return String.valueOf(o);
    }

    /** Decode a hex (with or without {@code 0x}) or base64 bytes field as the node serves it. */
    private static byte[] wire(String s) {
        if (s == null || s.isEmpty()) {
            return new byte[0];
        }
        String v = s.startsWith("0x") || s.startsWith("0X") ? s.substring(2) : s;
        return Bytes.decodeWireBytes(v);
    }

    /**
     * The inbox entries {@code from + 1 .. to} of a qledger-v1 rollup, read back from the
     * transactions that posted them (the chain keeps only commitments; the bytes stay in block
     * history). Posts come from {@code MsgPostRollupData}, deposits from the {@code
     * rdk_rollup_deposit} event. Needs a node with transaction indexing on.
     *
     * <p>Entries are never returned unverified: the accumulator recomputed from {@code accFrom}
     * over them must equal the chain's accumulator at {@code to}, the {@code inboxAcc} of post
     * {@code to} ({@code rest.getPostedData}) or, when that commitment is no longer retained and
     * {@code to} is the head, the inbox's {@code headAcc}.
     *
     * @throws IllegalStateException when an entry is missing, does not match the chain, or the
     *     chain no longer holds an accumulator at {@code to} to check against
     */
    public static List<QledgerEntry> fetchEntries(
            RestClient rest, String chainId, String rollupId, long from, long to, byte[] accFrom) {
        Map<Long, QledgerEntry> bySeq = new HashMap<>();
        for (Map<String, Object> tx : rest.searchTxs(query("rdk_data_posted", rollupId))) {
            long height = parseU64(str(tx.get("height")));
            List<Map<String, Object>> msgs = new ArrayList<>();
            for (Object m : list(rec(rec(tx.get("tx")).get("body")).get("messages"))) {
                Map<String, Object> mm = rec(m);
                if ("/qorechain.rdk.v1.MsgPostRollupData".equals(mm.get("@type"))) {
                    msgs.add(mm);
                }
            }
            for (Object evo : list(tx.get("events"))) {
                Map<String, Object> ev = rec(evo);
                if (!"rdk_data_posted".equals(ev.get("type"))) {
                    continue;
                }
                Map<String, String> a = attrs(ev);
                if (!rollupId.equals(a.get("rollup_id"))) {
                    continue;
                }
                long seq = parseU64(a.getOrDefault("sequence", "0"));
                if (Long.compareUnsigned(seq, from) <= 0 || Long.compareUnsigned(seq, to) > 0) {
                    continue;
                }
                String poster = a.getOrDefault("poster", "");
                String dataHash = a.getOrDefault("data_hash", "").toLowerCase();
                byte[] payload = null;
                for (Map<String, Object> m : msgs) {
                    byte[] d = Base64.getDecoder().decode(str(m.get("data")));
                    if (Bytes.bytesToHex(Inbox.postedDataHash(d)).equals(dataHash) && poster.equals(str(m.get("poster")))) {
                        payload = d;
                        break;
                    }
                }
                if (payload == null) {
                    throw new IllegalStateException(
                            "qledger: post "
                                    + u(seq)
                                    + " is in transaction "
                                    + str(tx.get("txhash"))
                                    + " but its payload could not be matched");
                }
                bySeq.put(seq, new QledgerEntry(height, poster, payload));
            }
        }
        for (Map<String, Object> tx : rest.searchTxs(query("rdk_rollup_deposit", rollupId))) {
            long height = parseU64(str(tx.get("height")));
            for (Object evo : list(tx.get("events"))) {
                Map<String, Object> ev = rec(evo);
                if (!"rdk_rollup_deposit".equals(ev.get("type"))) {
                    continue;
                }
                Map<String, String> a = attrs(ev);
                if (!rollupId.equals(a.get("rollup_id"))) {
                    continue;
                }
                long seq = parseU64(a.getOrDefault("sequence", "0"));
                if (Long.compareUnsigned(seq, from) <= 0 || Long.compareUnsigned(seq, to) > 0) {
                    continue;
                }
                long amount = parseU64(a.getOrDefault("amount", "0").replaceAll("uqor$", ""));
                bySeq.put(
                        seq,
                        new QledgerEntry(
                                height,
                                QledgerTx.DEPOSIT_POSTER_PREFIX + a.getOrDefault("depositor", ""),
                                QledgerTx.encodeDeposit(Bytes.hexToBytes(a.getOrDefault("account", "")), amount)));
            }
        }
        List<QledgerEntry> entries = new ArrayList<>();
        for (long s = from + 1; Long.compareUnsigned(s, to) <= 0; s++) {
            QledgerEntry e = bySeq.get(s);
            if (e == null) {
                throw new IllegalStateException(
                        "qledger: inbox entry "
                                + u(s)
                                + " of rollup "
                                + rollupId
                                + " was not found in the node's transaction index");
            }
            entries.add(e);
            if (s == to) {
                break; // to = max uint64 would otherwise wrap
            }
        }
        if (!entries.isEmpty()) {
            byte[] accTo = accumulate(chainId, rollupId, from, accFrom, entries);
            byte[] chainAcc;
            try {
                chainAcc = wire(rest.getPostedData(rollupId, to).inboxAcc);
            } catch (RuntimeException e) {
                if (!isNotFound(e)) {
                    throw e;
                }
                InboxView inbox = rest.getInbox(rollupId);
                if (inbox.headSequence != to) {
                    throw new IllegalStateException(
                            "qledger: the chain no longer retains the accumulator at inbox entry "
                                    + u(to)
                                    + " of rollup "
                                    + rollupId
                                    + ", so the entries cannot be verified");
                }
                chainAcc = wire(inbox.headAcc);
            }
            if (!Arrays.equals(accTo, chainAcc)) {
                throw new IllegalStateException(
                        "qledger: the fetched entries do not match the chain's inbox accumulator at entry " + u(to));
            }
        }
        return entries;
    }

    /** Whether a REST read failed with HTTP 404 (absent or no longer retained); any other error is real. */
    static boolean isNotFound(RuntimeException e) {
        String msg = e.getMessage();
        return msg != null && msg.endsWith(" failed: 404");
    }

    private static String query(String event, String rollupId) {
        return event + ".rollup_id='" + rollupId + "'";
    }

    /** The inbox accumulator after {@code entries}, starting from {@code accFrom} at sequence {@code from}. */
    public static byte[] accumulate(
            String chainId, String rollupId, long from, byte[] accFrom, List<QledgerEntry> entries) {
        byte[] acc = accFrom == null || accFrom.length == 0 ? Inbox.emptyInboxAcc() : accFrom.clone();
        for (int i = 0; i < entries.size(); i++) {
            QledgerEntry e = entries.get(i);
            acc =
                    Inbox.inboxAccumulate(
                            chainId, rollupId, acc, from + i + 1, e.height, e.poster, Inbox.postedDataHash(e.payload));
        }
        return acc;
    }

    /** A qledger-v1 batch ready for {@code RdkTxClient.submitBatch}, with what it settles. */
    public static final class BatchPlan {
        /** Pass to {@code submitBatch} (the client fills in the sequencer). */
        public final SubmitBatchInput input;
        /** The entries consumed. */
        public final List<QledgerEntry> entries;
        /** The execution result (withdrawals to pay later). */
        public final QledgerResult result;
        /** The ledger after the batch: the parent state of the next one. */
        public final QledgerLedger ledger;

        BatchPlan(SubmitBatchInput input, List<QledgerEntry> entries, QledgerResult result, QledgerLedger ledger) {
            this.input = input;
            this.entries = entries;
            this.result = result;
            this.ledger = ledger;
        }
    }

    /**
     * The facts {@link #batchErrors} needs, read from the chain for a batch of {@code submitter}
     * ending at {@code end}.
     *
     * @param inclusionMargin blocks added to the current height for the 20-block rule
     */
    public static BatchFacts readBatchFacts(
            RestClient rest, String rollupId, String submitter, long end, long inclusionMargin) {
        ParamsView params = rest.getParams();
        SubmitterBondView bond = rest.getSubmitterBond(rollupId, submitter);
        InboxView inbox = rest.getInbox(rollupId);
        BatchFacts f = new BatchFacts(inbox.consumedSequence, inbox.headSequence, end);
        f.bond = new BigInteger(bond.amount == null || bond.amount.isEmpty() ? "0" : bond.amount);
        f.minBond =
                params.minSubmitterBond == null || params.minSubmitterBond.isEmpty()
                        ? BigInteger.valueOf(Constants.DEFAULT_MIN_SUBMITTER_BOND_UQOR)
                        : new BigInteger(params.minSubmitterBond);
        f.pending = bond.pending;
        long head = inbox.headSequence;
        f.endRetained = Long.compareUnsigned(end, head) <= 0 && retained(rest, rollupId, head, end);
        if (Long.compareUnsigned(end, head) < 0) {
            try {
                f.nextHeight = rest.getPostedData(rollupId, end + 1).height;
                f.nextRetained = Boolean.TRUE;
            } catch (RuntimeException e) {
                if (!isNotFound(e)) {
                    throw e;
                }
                f.nextRetained = Boolean.FALSE;
            }
        }
        f.inclusionHeight = rest.getLatestHeight() + inclusionMargin;
        return f;
    }

    private static boolean retained(RestClient rest, String rollupId, long head, long x) {
        if (x == head) {
            return true;
        }
        String h = rest.getInbox(rollupId, x).rangeDataHash;
        return h != null && !h.isEmpty();
    }

    /**
     * Plan the next qledger-v1 batch of a rollup from the chain: choose {@code end} by the
     * admission rules, fetch and verify the entries, execute them on {@code ledger} (the state
     * after the rollup's latest batch, or an empty ledger before the first), and return the batch.
     * {@code ledger} is not modified; the submitter keeps {@code plan.ledger} as the parent state of
     * its next batch once this one settles.
     *
     * @param inclusionMargin blocks added to the current height for the 20-block rule (5 is a
     *     reasonable default)
     * @throws IllegalStateException with the chain's reason when no batch can be admitted now (no
     *     bond, too many pending, nothing to consume), or when the chain's data does not match
     */
    public static BatchPlan planBatch(
            RestClient rest,
            String chainId,
            String rollupId,
            String submitter,
            QledgerLedger ledger,
            long inclusionMargin) {
        RollupView rollup = rest.getRollup(rollupId);
        if (!Enums.EXECUTION_VM_QLEDGER_V1.equals(rollup.executionVm)) {
            throw new IllegalStateException("rollup " + rollupId + " is not a qledger-v1 rollup");
        }
        InboxView inbox = rest.getInbox(rollupId);
        long consumed = inbox.consumedSequence;
        long head = inbox.headSequence;
        Long end = chooseBatchEnd(consumed, head, x -> retained(rest, rollupId, head, x));
        if (end == null) {
            throw new IllegalStateException("rollup " + rollupId + " has nothing to settle: its inbox is fully consumed");
        }
        List<String> errors = batchErrors(readBatchFacts(rest, rollupId, submitter, end, inclusionMargin));
        if (!errors.isEmpty()) {
            throw new IllegalStateException("no qledger-v1 batch can be admitted now: " + String.join("; ", errors));
        }

        byte[] accFrom = wire(inbox.consumedAcc);
        List<QledgerEntry> entries = fetchEntries(rest, chainId, rollupId, consumed, end, accFrom);
        byte[] accTo = accumulate(chainId, rollupId, consumed, accFrom, entries);
        byte[] dataHash = Inbox.inboxRangeHash(chainId, rollupId, consumed, end, accFrom, accTo);
        String chainRange = rest.getInbox(rollupId, end).rangeDataHash;
        if (chainRange != null && !chainRange.isEmpty() && !Arrays.equals(dataHash, wire(chainRange))) {
            throw new IllegalStateException(
                    "qledger: the fetched entries do not hash to the chain's inbox range commitment");
        }

        BatchView latest;
        try {
            latest = rest.getLatestBatch(rollupId);
        } catch (RuntimeException e) {
            if (!isNotFound(e)) {
                throw e;
            }
            latest = null; // no batch yet
        }
        byte[] prevStateRoot = latest != null ? wire(latest.stateRoot) : QledgerTree.emptyRoot();
        byte[] root = ledger.root();
        if (!Arrays.equals(root, prevStateRoot)) {
            throw new IllegalStateException(
                    "qledger: the ledger you passed has root "
                            + Bytes.bytesToHex(root)
                            + ", but the rollup's latest state root is "
                            + Bytes.bytesToHex(prevStateRoot));
        }
        QledgerLedger next = ledger.clone();
        QledgerResult result = QledgerExec.execute(chainId, rollupId, next, entries);
        SubmitBatchInput in = new SubmitBatchInput();
        in.rollupId = rollupId;
        in.batchIndex = latest != null ? Integer.toUnsignedLong(latest.batchIndex) + 1 : 0;
        in.prevStateRoot = prevStateRoot;
        in.stateRoot = result.stateRoot;
        in.txCount = entries.size();
        in.dataHash = dataHash;
        in.withdrawalsRoot = result.withdrawalsRoot;
        in.inboxEnd = end;
        return new BatchPlan(in, entries, result, next);
    }

    /** {@link #planBatch(RestClient, String, String, String, QledgerLedger, long)} with a 5-block margin. */
    public static BatchPlan planBatch(
            RestClient rest, String chainId, String rollupId, String submitter, QledgerLedger ledger) {
        return planBatch(rest, chainId, rollupId, submitter, ledger, 5);
    }
}
