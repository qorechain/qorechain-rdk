package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.FieldNamingPolicy;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.config.Networks.Endpoints;
import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.qledger.QledgerBatch;
import io.github.qorechain.rdk.qledger.QledgerEntry;
import io.github.qorechain.rdk.qledger.QledgerExec;
import io.github.qorechain.rdk.qledger.QledgerFraud;
import io.github.qorechain.rdk.qledger.QledgerLedger;
import io.github.qorechain.rdk.qledger.QledgerResult;
import io.github.qorechain.rdk.qledger.QledgerTx;
import io.github.qorechain.rdk.transition.Transition;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.rdk.watchtower.QledgerEntryReader;
import io.github.qorechain.rdk.watchtower.QledgerJudge;
import io.github.qorechain.rdk.watchtower.QledgerJudgement;
import io.github.qorechain.rdk.watchtower.QledgerValidatorOptions;
import io.github.qorechain.rdk.watchtower.Watchtower;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Watching a qledger-v1 rollup: the judge decides each batch as the chain decides a challenge
 * against it, from the {@code qledger} vectors in {@code v328.json} served by a fake node.
 */
class WatchtowerQledgerTest {
    // The fixture's qledger batch: 11 inbox entries (sequences 4 to 14), settled from the empty
    // ledger, with the roots the chain accepted.
    private static final QledgerFixture Q = QledgerFixture.load();
    private static final List<QledgerEntry> ENTRIES = Q.qledgerEntries();
    private static final String RID = Q.rollupId;
    private static final long START = Q.batch.inboxStart;
    private static final long END = Q.batch.inboxEnd;

    private static byte[] h(String hex) {
        return Bytes.hexToBytes(hex);
    }

    private static String hex(byte[] b) {
        return Bytes.bytesToHex(b);
    }

    /** Entries {@code from + 1} to {@code to} of {@code list}, as a node's transaction index would return them. */
    private static QledgerEntryReader reader(List<QledgerEntry> list) {
        return (from, to, accFrom) -> new ArrayList<>(list.subList((int) (from - START), (int) (to - START)));
    }

    private static QledgerEntryReader reader() {
        return reader(ENTRIES);
    }

    private static QledgerValidatorOptions opts(QledgerEntryReader read) {
        QledgerValidatorOptions o = new QledgerValidatorOptions();
        o.readEntries = read;
        return o;
    }

    /** A reader that records each range it is asked for as {@code "from-to"}. */
    private static QledgerEntryReader recording(List<String> ranges) {
        return (from, to, accFrom) -> {
            ranges.add(from + "-" + to);
            return reader().read(from, to, accFrom);
        };
    }

    /** A batch as the node serves it. */
    private static final class RawBatch {
        int batchIndex;
        String status = "submitted";
        String prevStateRoot = Q.emptyRoot;
        String stateRoot = Q.batch.stateRoot;
        String withdrawalsRoot = Q.batch.withdrawalsRoot;
        String dataHash = Q.batch.dataHash;
        int txCount = ENTRIES.size();
        long inboxStart = START;
        long inboxEnd = END;
        long submittedAt = 100;
        boolean withdrawalsBound = true;

        RawBatch with(Consumer<RawBatch> change) {
            RawBatch c = new RawBatch();
            c.batchIndex = batchIndex;
            c.status = status;
            c.prevStateRoot = prevStateRoot;
            c.stateRoot = stateRoot;
            c.withdrawalsRoot = withdrawalsRoot;
            c.dataHash = dataHash;
            c.txCount = txCount;
            c.inboxStart = inboxStart;
            c.inboxEnd = inboxEnd;
            c.submittedAt = submittedAt;
            c.withdrawalsBound = withdrawalsBound;
            change.accept(c);
            return c;
        }
    }

    private static final RawBatch HONEST = new RawBatch();

    private static final Gson SNAKE =
            new GsonBuilder().setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES).create();
    private static final Pattern POSTED = Pattern.compile("^/qorechain/rdk/v1/posted_data/[^/]+/(\\d+)$");

    /** A node serving one qledger-v1 rollup: its batches and the inbox accumulator after each post. */
    private static final class Node {
        final RdkClient client;
        final List<String> paths = new ArrayList<>();
        final List<Map<String, Object>> posts = new ArrayList<>();
        final List<Map<String, Object>> deposits = new ArrayList<>();

        Node(List<RawBatch> batches, Map<Long, String> accs) {
            Transport t =
                    new MockTransport(
                            req -> {
                                String path = req.url.replace("http://node", "");
                                paths.add(path);
                                if (path.startsWith("/qorechain/rdk/v1/batches/")) {
                                    return new Transport.Response(
                                            200, SNAKE.toJson(Map.of("batches", batches, "next_index", 0)));
                                }
                                Matcher posted = POSTED.matcher(path);
                                if (posted.matches()) {
                                    String acc = accs.get(Long.parseLong(posted.group(1)));
                                    return acc == null
                                            ? new Transport.Response(404, "{\"code\":5,\"message\":\"not found\"}")
                                            : new Transport.Response(
                                                    200,
                                                    SNAKE.toJson(
                                                            Map.of(
                                                                    "posted_data",
                                                                    Map.of("sequence", posted.group(1), "inbox_acc", acc))));
                                }
                                if (path.startsWith("/cosmos/tx/v1beta1/txs?query=")) {
                                    String q =
                                            URLDecoder.decode(
                                                    path.split("query=")[1].split("&")[0], StandardCharsets.UTF_8);
                                    List<Map<String, Object>> txs = q.startsWith("rdk_data_posted") ? posts : deposits;
                                    return new Transport.Response(
                                            200,
                                            SNAKE.toJson(
                                                    Map.of("tx_responses", txs, "total", String.valueOf(txs.size()))));
                                }
                                return null;
                            });
            RdkClient.Options o = new RdkClient.Options();
            o.network = "testnet";
            o.transport = t;
            o.endpoints = new Endpoints("http://node", "http://node", "", "http://node");
            client = new RdkClient(o);
            assertEquals(Q.chainId, client.network.chainId);
        }

        BatchView batch(int index) {
            for (BatchView b : client.rest.listBatches(RID)) {
                if (b.batchIndex == index && !"rejected".equals(b.status)) {
                    return b;
                }
            }
            throw new AssertionError("no batch " + index);
        }

        private static final String DEPOSIT = QledgerTx.DEPOSIT_POSTER_PREFIX;

        /** Put {@code entries}, consumed after inbox entry {@code from}, in the node's transaction index. */
        void index(List<QledgerEntry> entries, long from) {
            for (int i = 0; i < entries.size(); i++) {
                QledgerEntry e = entries.get(i);
                String seq = Long.toString(from + i + 1);
                if (e.poster.startsWith(DEPOSIT)) {
                    QledgerTx.Deposit d = QledgerTx.decodeDeposit(e.payload);
                    deposits.add(
                            Map.of(
                                    "height", Long.toString(e.height),
                                    "txhash", "D" + seq,
                                    "events",
                                    List.of(
                                            Map.of(
                                                    "type", "rdk_rollup_deposit",
                                                    "attributes",
                                                    List.of(
                                                            attr("rollup_id", RID),
                                                            attr("depositor", e.poster.substring(DEPOSIT.length())),
                                                            attr("account", hex(d.account)),
                                                            attr("amount", Long.toUnsignedString(d.amount) + "uqor"),
                                                            attr("sequence", seq))))));
                } else {
                    Map<String, Object> msg = new LinkedHashMap<>();
                    msg.put("@type", "/qorechain.rdk.v1.MsgPostRollupData");
                    msg.put("poster", e.poster);
                    msg.put("rollup_id", RID);
                    msg.put("data", Base64.getEncoder().encodeToString(e.payload));
                    posts.add(
                            Map.of(
                                    "height", Long.toString(e.height),
                                    "txhash", "P" + seq,
                                    "tx", Map.of("body", Map.of("messages", List.of(msg))),
                                    "events",
                                    List.of(
                                            Map.of(
                                                    "type", "rdk_data_posted",
                                                    "attributes",
                                                    List.of(
                                                            attr("rollup_id", RID),
                                                            attr("sequence", seq),
                                                            attr("data_hash", hex(Inbox.postedDataHash(e.payload))),
                                                            attr("poster", e.poster))))));
                }
            }
        }

        private static Map<String, String> attr(String k, String v) {
            return Map.of("key", k, "value", v);
        }
    }

    private static Map<Long, String> accsOneBatch() {
        Map<Long, String> accs = new HashMap<>();
        accs.put(START, Q.batch.accFrom);
        return accs;
    }

    @Test
    void theTransitionRootRuleReportsThisHonestBatchAsInvalid() {
        Node node = new Node(List.of(HONEST), accsOneBatch());
        BatchView b = node.batch(0);
        Transition.Input in = new Transition.Input();
        in.chainId = Q.chainId;
        in.rollupId = RID;
        in.prevStateRoot = Bytes.decodeWireBytes(b.prevStateRoot);
        in.dataHash = Bytes.decodeWireBytes(b.dataHash);
        in.txCount = b.txCount;
        in.withdrawalsRoot = Bytes.decodeWireBytes(b.withdrawalsRoot);
        byte[] canonical = Transition.root(in, Transition.versionForBatch(node.client.rest, b));
        assertNotEquals(Q.batch.stateRoot, hex(canonical));
        assertTrue(Watchtower.qledgerValidator(node.client, RID, opts(reader())).test(b));
    }

    @Test
    void acceptsTheHonestBatchAndThereIsNoProofToSendAgainstIt() {
        Node node = new Node(List.of(HONEST), accsOneBatch());
        BatchView b = node.batch(0);
        assertTrue(Watchtower.qledgerValidator(node.client, RID, opts(reader())).test(b));
        assertNull(Watchtower.qledgerFraudProofForBatch(node.client, RID, b, opts(reader())));
        QledgerJudgement j = new QledgerJudge(node.client, RID, opts(reader())).judge(b);
        assertTrue(j.valid());
        assertNull(j.proof());
        assertEquals(Q.batch.stateRoot, hex(j.honestStateRoot()));
        assertEquals(Q.batch.withdrawalsRoot, hex(j.honestWithdrawalsRoot()));
    }

    @Test
    void aWrongStateRootIsRejectedWithAProofTheChainsOwnCheckUpholds() {
        RawBatch wrong = HONEST.with(x -> x.stateRoot = "ab".repeat(32));
        Node node = new Node(List.of(wrong), accsOneBatch());
        BatchView b = node.batch(0);
        assertFalse(Watchtower.qledgerValidator(node.client, RID, opts(reader())).test(b));
        byte[] proof = Watchtower.qledgerFraudProofForBatch(node.client, RID, b, opts(reader()));
        assertNotNull(proof);
        QledgerFraud.Claim claim =
                new QledgerFraud.Claim(
                        START,
                        END,
                        h(wrong.dataHash),
                        h(wrong.prevStateRoot),
                        h(wrong.stateRoot),
                        h(wrong.withdrawalsRoot));
        assertTrue(QledgerFraud.check(Q.chainId, RID, claim, proof));
        // The same proof does not win against the honest roots.
        claim.stateRoot = h(Q.batch.stateRoot);
        assertFalse(QledgerFraud.check(Q.chainId, RID, claim, proof));

        QledgerJudgement j = new QledgerJudge(node.client, RID, opts(reader())).judge(b);
        assertFalse(j.valid());
        assertEquals(hex(proof), hex(j.proof()));
        assertEquals(Q.batch.stateRoot, hex(j.honestStateRoot()));
        assertEquals(Q.batch.withdrawalsRoot, hex(j.honestWithdrawalsRoot()));
    }

    @Test
    void aWrongWithdrawalsRootIsRejected() {
        RawBatch wrong = HONEST.with(x -> x.withdrawalsRoot = "cd".repeat(32));
        Node node = new Node(List.of(wrong), accsOneBatch());
        BatchView b = node.batch(0);
        assertFalse(Watchtower.qledgerValidator(node.client, RID, opts(reader())).test(b));
        byte[] proof = Watchtower.qledgerFraudProofForBatch(node.client, RID, b, opts(reader()));
        QledgerFraud.Claim claim =
                new QledgerFraud.Claim(
                        START,
                        END,
                        h(wrong.dataHash),
                        h(wrong.prevStateRoot),
                        h(wrong.stateRoot),
                        h(wrong.withdrawalsRoot));
        assertTrue(QledgerFraud.check(Q.chainId, RID, claim, proof));

        // A batch that leaves its withdrawals out is rejected too.
        RawBatch none = HONEST.with(x -> x.withdrawalsRoot = "");
        Node node2 = new Node(List.of(none), accsOneBatch());
        assertFalse(Watchtower.qledgerValidator(node2.client, RID, opts(reader())).test(node2.batch(0)));
    }

    @Test
    void entriesThatDoNotBelongToTheBatchLeaveItUndecidedRatherThanInvalid() {
        Node node = new Node(List.of(HONEST), accsOneBatch());
        BatchView b = node.batch(0);
        List<QledgerEntry> shortList = ENTRIES.subList(0, ENTRIES.size() - 1);
        IllegalArgumentException e =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> Watchtower.qledgerValidator(node.client, RID, opts((f, t, a) -> shortList)).test(b));
        assertTrue(e.getMessage().contains("does not apply"), e.getMessage());

        List<QledgerEntry> swapped = new ArrayList<>(ENTRIES);
        swapped.set(1, ENTRIES.get(2));
        swapped.set(2, ENTRIES.get(1));
        e =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> Watchtower.qledgerFraudProofForBatch(node.client, RID, b, opts(reader(swapped))));
        assertTrue(e.getMessage().contains("does not apply"), e.getMessage());

        // The judge is not left in a bad state: the right entries still decide the batch.
        QledgerEntryReader[] current = {(f, t, a) -> shortList};
        QledgerJudge judge = new QledgerJudge(node.client, RID, opts((f, t, a) -> current[0].read(f, t, a)));
        assertThrows(IllegalArgumentException.class, () -> judge.judge(b));
        current[0] = reader();
        assertTrue(judge.judge(b).valid());
    }

    @Test
    void anInjectedReaderIsUsedInsteadOfTheNodesTransactionIndex() {
        Node node = new Node(List.of(HONEST), accsOneBatch());
        BatchView b = node.batch(0);
        List<String> calls = new ArrayList<>();
        QledgerEntryReader read =
                (from, to, accFrom) -> {
                    calls.add(from + "-" + to + ":" + hex(accFrom));
                    return reader().read(from, to, accFrom);
                };
        assertTrue(Watchtower.qledgerValidator(node.client, RID, opts(read)).test(b));
        assertEquals(List.of(START + "-" + END + ":" + Q.batch.accFrom), calls);
        assertTrue(node.paths.stream().noneMatch(p -> p.startsWith("/cosmos/tx/")), String.valueOf(node.paths));
    }

    @Test
    void byDefaultReadsTheEntriesFromTheNodesTransactionIndex() {
        Map<Long, String> accs = accsOneBatch();
        accs.put(END, hex(QledgerBatch.accumulate(Q.chainId, RID, START, h(Q.batch.accFrom), ENTRIES)));
        Node node = new Node(List.of(HONEST), accs);
        node.index(ENTRIES, START);
        BatchView b = node.batch(0);
        assertTrue(Watchtower.qledgerValidator(node.client, RID).test(b));
        assertTrue(node.paths.stream().anyMatch(p -> p.startsWith("/cosmos/tx/v1beta1/txs?query=rdk_data_posted")));
        assertTrue(node.paths.contains("/qorechain/rdk/v1/posted_data/" + RID + "/" + END));

        RawBatch wrong = HONEST.with(x -> x.stateRoot = "ab".repeat(32));
        Node bad = new Node(List.of(wrong), accs);
        bad.index(ENTRIES, START);
        BatchView w = bad.batch(0);
        assertFalse(Watchtower.qledgerValidator(bad.client, RID).test(w));
        assertNotNull(Watchtower.qledgerFraudProofForBatch(bad.client, RID, w));
    }

    // --- across batches: the fixture's entries split into two batches settled in turn ---

    private static final int CUT = 5;
    private static final long MID = START + CUT;
    private static final RawBatch B0;
    private static final RawBatch B1;
    private static final Map<Long, String> ACCS = new HashMap<>();
    private static final QledgerResult R2;

    static {
        List<QledgerEntry> first = ENTRIES.subList(0, CUT);
        List<QledgerEntry> second = ENTRIES.subList(CUT, ENTRIES.size());
        QledgerLedger ledger = new QledgerLedger();
        QledgerResult r1 = QledgerExec.execute(Q.chainId, RID, ledger, first);
        R2 = QledgerExec.execute(Q.chainId, RID, ledger, second);
        byte[] accFrom = h(Q.batch.accFrom);
        byte[] accMid = QledgerBatch.accumulate(Q.chainId, RID, START, accFrom, first);
        byte[] accEnd = QledgerBatch.accumulate(Q.chainId, RID, MID, accMid, second);
        B0 =
                HONEST.with(
                        x -> {
                            x.stateRoot = hex(r1.stateRoot);
                            x.withdrawalsRoot = hex(r1.withdrawalsRoot);
                            x.dataHash = hex(Inbox.inboxRangeHash(Q.chainId, RID, START, MID, accFrom, accMid));
                            x.txCount = first.size();
                            x.inboxEnd = MID;
                        });
        B1 =
                HONEST.with(
                        x -> {
                            x.batchIndex = 1;
                            x.prevStateRoot = hex(r1.stateRoot);
                            x.stateRoot = hex(R2.stateRoot);
                            x.withdrawalsRoot = hex(R2.withdrawalsRoot);
                            x.dataHash = hex(Inbox.inboxRangeHash(Q.chainId, RID, MID, END, accMid, accEnd));
                            x.txCount = second.size();
                            x.inboxStart = MID;
                            x.submittedAt = 101;
                        });
        ACCS.put(START, Q.batch.accFrom);
        ACCS.put(MID, hex(accMid));
    }

    @Test
    void theSecondHalfContinuesTheWithdrawalIndexAndEndsAtTheChainsRoot() {
        assertNotEquals("", B0.withdrawalsRoot);
        assertEquals(1, R2.withdrawals.size());
        assertEquals(Q.batch.withdrawals.get(1).index, R2.withdrawals.get(0).index);
        assertEquals(Q.batch.stateRoot, B1.stateRoot);
    }

    @Test
    void rebuildsTheParentStateByReplayingEarlierBatches() {
        Node node = new Node(List.of(B0, B1), ACCS);
        BatchView b1 = node.batch(1);
        List<String> ranges = new ArrayList<>();
        Predicate<BatchView> validate =
                Watchtower.qledgerValidator(node.client, RID, opts(recording(ranges)));
        assertTrue(validate.test(b1));
        assertEquals(List.of(START + "-" + MID, MID + "-" + END), ranges);
        // The state after batch 0 is now known, so judging batch 1 again reads only its own entries.
        ranges.clear();
        assertTrue(validate.test(b1));
        assertEquals(List.of(MID + "-" + END), ranges);
    }

    @Test
    void judgingBatchesInOrderUsesTheCachedStateWithoutReplay() {
        Node node = new Node(List.of(B0, B1), ACCS);
        BatchView b0 = node.batch(0);
        BatchView b1 = node.batch(1);
        node.paths.clear();
        List<String> ranges = new ArrayList<>();
        QledgerJudge judge = new QledgerJudge(node.client, RID, opts(recording(ranges)));
        QledgerJudgement j0 = judge.judge(b0);
        QledgerJudgement j1 = judge.judge(b1);
        assertTrue(j0.valid());
        assertTrue(j1.valid());
        assertEquals(B0.stateRoot, hex(j0.honestStateRoot()));
        assertEquals(hex(R2.withdrawalsRoot), hex(j1.honestWithdrawalsRoot()));
        assertEquals(List.of(START + "-" + MID, MID + "-" + END), ranges);
        assertTrue(node.paths.stream().noneMatch(p -> p.contains("/batches/")), String.valueOf(node.paths));
    }

    @Test
    void statesBeyondMaxCachedStatesAreDroppedAndRebuiltByReplay() {
        Node node = new Node(List.of(B0, B1), ACCS);
        BatchView b0 = node.batch(0);
        BatchView b1 = node.batch(1);
        List<String> ranges = new ArrayList<>();
        QledgerValidatorOptions o = opts(recording(ranges));
        o.maxCachedStates = 1; // at least 2 are kept: the empty ledger and one more
        QledgerJudge judge = new QledgerJudge(node.client, RID, o);
        assertTrue(judge.judge(b0).valid());
        assertTrue(judge.judge(b1).valid());
        // Accepting batch 1 dropped the state after batch 0, so judging batch 1 again replays.
        ranges.clear();
        assertTrue(judge.judge(b1).valid());
        assertEquals(List.of(START + "-" + MID, MID + "-" + END), ranges);
        // The empty ledger is always kept: batch 0 needs no replay.
        ranges.clear();
        node.paths.clear();
        assertTrue(judge.judge(b0).valid());
        assertEquals(List.of(START + "-" + MID), ranges);
        assertTrue(node.paths.stream().noneMatch(p -> p.contains("/batches/")), String.valueOf(node.paths));
    }

    @Test
    void aBatchBuiltOnARootNoHonestReplayReachesIsUndecidedAndTheEarlierBatchIsTheOneFlagged() {
        RawBatch bad0 = B0.with(x -> x.stateRoot = "ef".repeat(32));
        RawBatch on0 = B1.with(x -> x.prevStateRoot = bad0.stateRoot);
        Node node = new Node(List.of(bad0, on0), ACCS);
        Predicate<BatchView> validate =
                Watchtower.qledgerValidator(node.client, RID, opts(reader()));
        assertFalse(validate.test(node.batch(0)));
        BatchView b1 = node.batch(1);
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> validate.test(b1));
        assertTrue(e.getMessage().contains("no honest replay"), e.getMessage());
        assertTrue(e.getMessage().contains("ef".repeat(32)), e.getMessage());
        assertThrows(
                IllegalStateException.class,
                () -> Watchtower.qledgerFraudProofForBatch(node.client, RID, b1, opts(reader())));
    }

    @Test
    void skipsRejectedBatchesWhileReplaying() {
        // A rejected batch whose inbox range the entries do not hash to: judging it would throw.
        RawBatch rejected =
                B0.with(
                        x -> {
                            x.status = "rejected";
                            x.stateRoot = "ef".repeat(32);
                            x.dataHash = "00".repeat(32);
                        });
        Node node = new Node(List.of(rejected, B0, B1), ACCS);
        List<String> ranges = new ArrayList<>();
        assertTrue(Watchtower.qledgerValidator(node.client, RID, opts(recording(ranges))).test(node.batch(1)));
        assertEquals(List.of(START + "-" + MID, MID + "-" + END), ranges);
    }

    @Test
    void judgeCallsAreSerialized() throws Exception {
        Node node = new Node(List.of(B0, B1), ACCS);
        BatchView b0 = node.batch(0);
        BatchView b1 = node.batch(1);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger reads = new AtomicInteger();
        QledgerEntryReader blocking =
                (from, to, accFrom) -> {
                    if (reads.getAndIncrement() == 0) {
                        entered.countDown();
                        try {
                            release.await(10, TimeUnit.SECONDS);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    return reader().read(from, to, accFrom);
                };
        QledgerJudge judge = new QledgerJudge(node.client, RID, opts(blocking));
        AtomicReference<Object> first = new AtomicReference<>();
        AtomicReference<Object> second = new AtomicReference<>();
        Thread t0 = new Thread(() -> first.set(judgeOrError(judge, b0)));
        Thread t1 = new Thread(() -> second.set(judgeOrError(judge, b1)));
        t0.start();
        try {
            assertTrue(entered.await(10, TimeUnit.SECONDS));
            t1.start();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (t1.getState() != Thread.State.BLOCKED
                    && t1.getState() != Thread.State.TERMINATED
                    && System.nanoTime() < deadline) {
                Thread.sleep(1);
            }
            // The second call waits for the first rather than replaying batch 0 itself.
            assertEquals(Thread.State.BLOCKED, t1.getState());
            assertEquals(1, reads.get());
        } finally {
            release.countDown();
            t0.join(10_000);
            t1.join(10_000);
        }
        assertTrue(validJudgement(first.get()), String.valueOf(first.get()));
        assertTrue(validJudgement(second.get()), String.valueOf(second.get()));
        assertEquals(2, reads.get());
    }

    private static boolean validJudgement(Object o) {
        return o instanceof QledgerJudgement j && j.valid();
    }

    private static Object judgeOrError(QledgerJudge judge, BatchView b) {
        try {
            return judge.judge(b);
        } catch (RuntimeException e) {
            return e;
        }
    }
}
