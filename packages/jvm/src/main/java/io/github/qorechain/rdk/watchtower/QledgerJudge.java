package io.github.qorechain.rdk.watchtower;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.qledger.QledgerBatch;
import io.github.qorechain.rdk.qledger.QledgerEntry;
import io.github.qorechain.rdk.qledger.QledgerExec;
import io.github.qorechain.rdk.qledger.QledgerFraud;
import io.github.qorechain.rdk.qledger.QledgerLedger;
import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;

/**
 * Judges the batches of one qledger-v1 rollup as the chain would judge a challenge against them,
 * keeping the honest ledger after each batch it accepts so the next batch is judged without a full
 * replay. {@link #judge} is synchronized; use one judge per rollup.
 *
 * <p>The chain decides a challenge against a qledger-v1 batch by re-executing the inbox entries the
 * batch consumed from its parent state and comparing the state and withdrawals roots it published
 * ({@link QledgerFraud#check}). A qledger-v1 state root is the root of the account tree, not the
 * canonical transition root other optimistic rollups publish, so the transition-root rule reports
 * every honest qledger-v1 batch as invalid. The judge applies the chain's own qledger-v1 rule: it
 * rebuilds the parent state by replaying the rollup's earlier batches, reads the entries the batch
 * consumed, builds the fraud proof a challenger would send ({@link QledgerFraud#build}), and
 * decides it with {@link QledgerFraud#check}, the same decision the chain makes.
 */
public final class QledgerJudge {
    private static final int DEFAULT_MAX_CACHED_STATES = 32;

    private final RdkClient client;
    private final String chainId;
    private final String rollupId;
    private final QledgerEntryReader read;
    private final int maxStates;
    private final String emptyRoot;
    /** Honest ledgers by state root (hex), oldest first. */
    private final LinkedHashMap<String, QledgerLedger> states = new LinkedHashMap<>();

    /** A judge reading entries with {@code QledgerBatch.fetchEntries} and keeping 32 states. */
    public QledgerJudge(RdkClient client, String rollupId) {
        this(client, rollupId, null);
    }

    /** A judge for {@code rollupId}; {@code options} may be {@code null}. */
    public QledgerJudge(RdkClient client, String rollupId, QledgerValidatorOptions options) {
        this.client = Objects.requireNonNull(client, "client");
        this.rollupId = Objects.requireNonNull(rollupId, "rollupId");
        this.chainId = client.network.chainId;
        QledgerValidatorOptions o = options == null ? new QledgerValidatorOptions() : options;
        this.maxStates =
                Math.max(2, o.maxCachedStates == null ? DEFAULT_MAX_CACHED_STATES : o.maxCachedStates);
        this.read =
                o.readEntries != null
                        ? o.readEntries
                        : (from, to, accFrom) ->
                                QledgerBatch.fetchEntries(client.rest, chainId, rollupId, from, to, accFrom);
        QledgerLedger empty = new QledgerLedger();
        this.emptyRoot = Bytes.bytesToHex(empty.root());
        this.states.put(emptyRoot, empty);
    }

    /**
     * Decide {@code batch} as the chain would decide a challenge against it.
     *
     * @throws IllegalStateException when the batch builds on a state root no honest replay of the
     *     rollup's batches reaches (the batch that introduced it is the one to challenge)
     * @throws IllegalArgumentException when the entries read do not belong to the batch, which
     *     leaves it undecided rather than invalid
     * @throws RuntimeException when a read from the node or the entry reader fails
     */
    public synchronized QledgerJudgement judge(BatchView batch) {
        Objects.requireNonNull(batch, "batch");
        QledgerLedger parent = ledgerAt(hexOf(batch.prevStateRoot));
        return judgeOn(parent, batch);
    }

    private static String hexOf(String wire) {
        return Bytes.bytesToHex(Bytes.decodeWireBytes(wire));
    }

    private void remember(String root, QledgerLedger ledger) {
        states.remove(root);
        states.put(root, ledger);
        while (states.size() > maxStates) {
            String oldest = null;
            for (String k : states.keySet()) {
                if (!k.equals(emptyRoot)) {
                    oldest = k;
                    break;
                }
            }
            if (oldest == null) {
                break;
            }
            states.remove(oldest);
        }
    }

    /** The inbox accumulator after entry {@code seq} (posted data is numbered from 1). */
    private byte[] accAfter(long seq) {
        if (seq == 0) {
            return Inbox.emptyInboxAcc();
        }
        return Bytes.decodeWireBytes(client.rest.getPostedData(rollupId, seq).inboxAcc);
    }

    private QledgerJudgement judgeOn(QledgerLedger parent, BatchView batch) {
        byte[] accFrom = accAfter(batch.inboxStart);
        List<QledgerEntry> entries =
                Objects.requireNonNull(
                        read.read(batch.inboxStart, batch.inboxEnd, accFrom),
                        "the entry reader returned no list");
        QledgerFraud.Built built = QledgerFraud.build(chainId, rollupId, parent, accFrom, entries);
        // The chain's own decision on that proof. It throws when the entries do not belong to this
        // batch, which leaves the batch undecided rather than invalid.
        boolean fraud =
                QledgerFraud.check(
                        chainId,
                        rollupId,
                        new QledgerFraud.Claim(
                                batch.inboxStart,
                                batch.inboxEnd,
                                Bytes.decodeWireBytes(batch.dataHash),
                                Bytes.decodeWireBytes(batch.prevStateRoot),
                                Bytes.decodeWireBytes(batch.stateRoot),
                                Bytes.decodeWireBytes(batch.withdrawalsRoot)),
                        built.proof);
        if (!fraud) {
            QledgerLedger next = parent.clone();
            QledgerExec.execute(chainId, rollupId, next, entries);
            remember(Bytes.bytesToHex(next.root()), next);
        }
        return new QledgerJudgement(
                !fraud, built.honest.stateRoot, built.honest.withdrawalsRoot, fraud ? built.proof : null);
    }

    /**
     * The honest ledger whose root is {@code root}, replaying the rollup's batches in order from the
     * empty ledger when it is not already known. Only a batch that reproduces from a known state is
     * followed, so a root that no honest replay reaches is refused: the batch that introduced it is
     * the one to challenge.
     */
    private QledgerLedger ledgerAt(String root) {
        QledgerLedger known = states.get(root);
        if (known != null) {
            return known;
        }
        List<BatchView> batches = new ArrayList<>();
        for (BatchView b : client.rest.listBatches(rollupId)) {
            if (!"rejected".equals(b.status)) {
                batches.add(b);
            }
        }
        batches.sort(Comparator.comparingInt(b -> b.batchIndex));
        for (BatchView b : batches) {
            if (states.containsKey(hexOf(b.stateRoot))) {
                continue;
            }
            QledgerLedger parent = states.get(hexOf(b.prevStateRoot));
            if (parent == null) {
                continue;
            }
            judgeOn(parent, b);
            QledgerLedger found = states.get(root);
            if (found != null) {
                return found;
            }
        }
        throw new IllegalStateException(
                "qledger: no honest replay of "
                        + rollupId
                        + " reaches state root "
                        + root
                        + "; a batch before this one published it, and that batch is the one a challenge"
                        + " wins against");
    }
}
