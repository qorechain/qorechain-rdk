package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views;
import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.qledger.QledgerBatch;
import io.github.qorechain.rdk.qledger.QledgerBatch.BatchFacts;
import io.github.qorechain.rdk.qledger.QledgerEntry;
import io.github.qorechain.rdk.qledger.QledgerLedger;
import io.github.qorechain.rdk.qledger.QledgerTree;
import io.github.qorechain.rdk.qledger.QledgerTx;
import io.github.qorechain.rdk.tx.Messages;
import io.github.qorechain.rdk.tx.Messages.SubmitBatchInput;
import io.github.qorechain.rdk.tx.RdkTxClient;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.rdk.zk.Zk;
import io.github.qorechain.rdk.zk.Zk.ZkBatchInputs;
import java.math.BigInteger;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongPredicate;
import org.junit.jupiter.api.Test;

/** qledger-v1 batch admission, the Groth16 withdrawals root modulo r, and planning against a fake node. */
class QledgerBatchTest {
    private static final QledgerFixture Q = QledgerFixture.load();
    private static final List<QledgerEntry> ENTRIES = Q.qledgerEntries();

    private static BatchFacts facts(long consumed, long head, long end) {
        BatchFacts f = new BatchFacts(consumed, head, end);
        f.bond = BigInteger.valueOf(2_000_000_000L);
        f.minBond = BigInteger.valueOf(1_000_000_000L);
        f.pending = 0;
        f.endRetained = true;
        return f;
    }

    private static String errs(BatchFacts f) {
        return String.join(",", QledgerBatch.batchErrors(f));
    }

    // --- admission rules ---

    @Test
    void checkpointsAreNonZeroMultiplesOf64() {
        assertFalse(QledgerBatch.isCheckpoint(0));
        assertFalse(QledgerBatch.isCheckpoint(1));
        assertFalse(QledgerBatch.isCheckpoint(63));
        assertTrue(QledgerBatch.isCheckpoint(64));
        assertTrue(QledgerBatch.isCheckpoint(128));
        assertEquals(20, QledgerBatch.FRESH_POST_BLOCKS);
        assertEquals(1024, QledgerBatch.MAX_PENDING_BATCHES_PER_SUBMITTER);
        assertEquals(64, QledgerBatch.CHECKPOINT_INTERVAL);
        assertEquals(50, QledgerBatch.SLASH_BURN_PERCENT);
    }

    @Test
    void bondPendingCapRangeAndSize() {
        assertEquals(List.of(), QledgerBatch.batchErrors(facts(0, 10, 10)));
        BatchFacts lowBond = facts(0, 10, 10);
        lowBond.bond = BigInteger.ONE;
        assertTrue(errs(lowBond).contains("bond"));
        BatchFacts busy = facts(0, 10, 10);
        busy.pending = 1024;
        assertTrue(errs(busy).contains("waiting"));
        assertTrue(errs(facts(5, 10, 5)).contains("at least one"));
        assertTrue(errs(facts(0, 10, 11)).contains("past the head"));
        assertTrue(errs(facts(0, 100, 65)).contains("at most 64"));
        assertEquals(List.of(), QledgerBatch.batchErrors(facts(0, 100, 64)));
    }

    @Test
    void aShortBatchBeforeTheHeadStopsBeforeAFreshPostOrAtAnUnretainedCheckpoint() {
        BatchFacts fresh = facts(0, 100, 10);
        fresh.nextRetained = true;
        fresh.nextHeight = 990L;
        fresh.inclusionHeight = 1000L;
        assertEquals(List.of(), QledgerBatch.batchErrors(fresh));
        BatchFacts old = facts(0, 100, 10);
        old.nextRetained = true;
        old.nextHeight = 980L;
        old.inclusionHeight = 1000L;
        assertTrue(errs(old).contains("post 11 must be in it"));
        BatchFacts gone = facts(0, 100, 10);
        gone.nextRetained = false;
        assertTrue(errs(gone).contains("post 11"));
        BatchFacts checkpoint = facts(40, 300, 64);
        checkpoint.nextRetained = false;
        assertEquals(List.of(), QledgerBatch.batchErrors(checkpoint));
        BatchFacts pruned = facts(0, 300, 20);
        pruned.endRetained = false;
        pruned.nextRetained = false;
        assertTrue(errs(pruned).contains("no longer retained"));
    }

    @Test
    void choosesTheEndTheChainRecommends() {
        LongPredicate all = x -> true;
        assertNull(QledgerBatch.chooseBatchEnd(5, 5, all));
        assertEquals(10L, QledgerBatch.chooseBatchEnd(0, 10, all));
        assertEquals(64L, QledgerBatch.chooseBatchEnd(0, 200, all));
        // After a long idle period only checkpoints kept their commitments.
        LongPredicate onlyCheckpoints = x -> x % 64 == 0;
        assertEquals(64L, QledgerBatch.chooseBatchEnd(40, 500, onlyCheckpoints));
        assertEquals(128L, QledgerBatch.chooseBatchEnd(64, 500, onlyCheckpoints));
    }

    @Test
    void postedDataRetentionConstants() {
        assertEquals(648_000L, Constants.DEFAULT_POSTED_DATA_RETENTION_BLOCKS);
        assertEquals(100L, Constants.MIN_POSTED_DATA_RETENTION_BLOCKS);
        assertEquals(25_920_000L, Constants.MAX_POSTED_DATA_RETENTION_BLOCKS);
    }

    // --- Groth16 withdrawals root modulo r ---

    @Test
    void anyWithdrawalsRootPassesThePrecheckAndTheCircuitTakesItModR() {
        BigInteger r = Zk.BLS12_381_SCALAR_MODULUS;
        byte[] high = Zk.toCanonicalScalar(new byte[0]); // placeholder, replaced below
        String highHex = String.format("%64s", r.add(BigInteger.valueOf(5)).toString(16)).replace(' ', '0');
        high = Bytes.hexToBytes(highHex);
        byte[] low = Bytes.hexToBytes("00".repeat(31) + "05");
        assertEquals(List.of(), Zk.zkPublicInputErrors(new ZkBatchInputs(null, low, null, high)));
        assertTrue(String.join(",", Zk.zkPublicInputErrors(new ZkBatchInputs(null, high, null, null))).contains("state_root"));
        List<byte[]> ins = Zk.zkPublicInputs(new ZkBatchInputs(low, low, null, high));
        assertEquals(4, ins.size());
        assertEquals(Bytes.bytesToHex(low), Bytes.bytesToHex(ins.get(0)));
        assertEquals(Bytes.bytesToHex(low), Bytes.bytesToHex(ins.get(1)));
        assertEquals("00".repeat(32), Bytes.bytesToHex(ins.get(2)));
        assertEquals(Bytes.bytesToHex(Zk.toCanonicalScalar(high)), Bytes.bytesToHex(ins.get(3)));
        assertEquals(Bytes.bytesToHex(low), Bytes.bytesToHex(ins.get(3)));
    }

    @Test
    void comparesModROnlyWhenTheChainReducedTheStoredRoot() {
        BigInteger r = Zk.BLS12_381_SCALAR_MODULUS;
        byte[] high = Bytes.hexToBytes(String.format("%64s", r.add(BigInteger.valueOf(5)).toString(16)).replace(' ', '0'));
        byte[] low = Bytes.hexToBytes("00".repeat(31) + "05");
        assertTrue(Zk.withdrawalsRootMatches(low, high, true));
        assertFalse(Zk.withdrawalsRootMatches(low, high, false));
        assertTrue(Zk.withdrawalsRootMatches(high, high, false));
    }

    @Test
    void viewsMapReducedRootAndPending() {
        assertTrue(Views.mapBatchView(Map.of("withdrawals_root_reduced", true)).withdrawalsRootReduced);
        assertFalse(Views.mapBatchView(Map.of()).withdrawalsRootReduced);
        assertEquals(7, Views.mapSubmitterBondView(Map.of("amount", "5", "pending", "7")).pending);
        assertEquals(0, Views.mapSubmitterBondView(Map.of()).pending);
    }

    // --- a fake node serving a qledger-v1 rollup whose inbox holds the fixture's entries ---

    private static final class FakeNode {
        final String chainId = Q.chainId;
        final String rollupId = Q.rollupId;
        final List<byte[]> accs = new ArrayList<>();
        final int head = ENTRIES.size();
        final List<Map<String, Object>> posts = new ArrayList<>();
        final List<Map<String, Object>> deposits = new ArrayList<>();
        final Map<String, Object> routes = new HashMap<>();
        final List<String> urls = new ArrayList<>();
        final Map<String, Integer> failures = new HashMap<>();

        FakeNode() {
            byte[] acc = new byte[0];
            for (int i = 0; i < ENTRIES.size(); i++) {
                acc = QledgerBatch.accumulate(chainId, rollupId, i, acc, List.of(ENTRIES.get(i)));
                accs.add(acc);
            }
            for (int i = 0; i < ENTRIES.size(); i++) {
                QledgerEntry e = ENTRIES.get(i);
                String seq = String.valueOf(i + 1);
                if (e.poster.startsWith("deposit:")) {
                    QledgerTx.Deposit d = QledgerTx.decodeDeposit(e.payload);
                    deposits.add(
                            Map.of(
                                    "height", String.valueOf(e.height),
                                    "txhash", "D" + seq,
                                    "events",
                                    List.of(
                                            Map.of(
                                                    "type", "rdk_rollup_deposit",
                                                    "attributes",
                                                    List.of(
                                                            attr("rollup_id", rollupId),
                                                            attr("depositor", e.poster.substring(8)),
                                                            attr("account", Bytes.bytesToHex(d.account)),
                                                            attr("amount", Long.toUnsignedString(d.amount) + "uqor"),
                                                            attr("sequence", seq))))));
                } else {
                    Map<String, Object> msg = new LinkedHashMap<>();
                    msg.put("@type", "/qorechain.rdk.v1.MsgPostRollupData");
                    msg.put("poster", e.poster);
                    msg.put("rollup_id", rollupId);
                    msg.put("data", Base64.getEncoder().encodeToString(e.payload));
                    posts.add(
                            Map.of(
                                    "height", String.valueOf(e.height),
                                    "txhash", "P" + seq,
                                    "tx", Map.of("body", Map.of("messages", List.of(msg))),
                                    "events",
                                    List.of(
                                            Map.of(
                                                    "type", "rdk_data_posted",
                                                    "attributes",
                                                    List.of(
                                                            attr("rollup_id", rollupId),
                                                            attr("sequence", seq),
                                                            attr("data_hash", Bytes.bytesToHex(Inbox.postedDataHash(e.payload))),
                                                            attr("poster", e.poster))))));
                }
            }
            Map<String, Object> inbox = new LinkedHashMap<>();
            inbox.put("head_sequence", String.valueOf(head));
            inbox.put("head_acc", Bytes.bytesToHex(accs.get(head - 1)));
            inbox.put("consumed_sequence", "0");
            inbox.put("consumed_acc", "00".repeat(32));
            inbox.put("range_end", String.valueOf(head));
            inbox.put("range_data_hash", range(head));
            routes.put(
                    "/qorechain/rdk/v1/rollup/" + rollupId,
                    Map.of(
                            "rollup",
                            Map.of(
                                    "rollup_id", rollupId,
                                    "execution_vm", "qledger-v1",
                                    "sequencing", "based",
                                    "settlement_mode", "optimistic",
                                    "da_backend", "native")));
            routes.put("/qorechain/rdk/v1/params", Map.of("params", Map.of("min_submitter_bond", "1000000000")));
            routes.put("/qorechain/rdk/v1/submitter_bond/" + rollupId + "/qor1sub", Map.of("amount", "1000000000", "pending", "0"));
            routes.put("/qorechain/rdk/v1/inbox/" + rollupId, Map.of("inbox", inbox));
            routes.put("/qorechain/rdk/v1/inbox/" + rollupId + "?inbox_end=" + head, Map.of("inbox", inbox));
            routes.put("/cosmos/base/node/v1beta1/status", Map.of("height", "1000"));
        }

        static Map<String, String> attr(String k, String v) {
            return Map.of("key", k, "value", v);
        }

        String range(int end) {
            return Bytes.bytesToHex(
                    Inbox.inboxRangeHash(chainId, rollupId, 0, end, new byte[0], accs.get(end - 1)));
        }

        RestClient rest() {
            Gson gson = new Gson();
            MockTransport t =
                    new MockTransport(
                            req -> {
                                String path = req.url.replace("http://node", "");
                                urls.add(path);
                                Integer status = failures.get(path);
                                if (status != null) {
                                    return new Transport.Response(status, "{}");
                                }
                                if (path.startsWith("/cosmos/tx/v1beta1/txs?query=")) {
                                    String q =
                                            URLDecoder.decode(
                                                    path.split("query=")[1].split("&")[0], StandardCharsets.UTF_8);
                                    List<Map<String, Object>> txs = q.startsWith("rdk_data_posted") ? posts : deposits;
                                    return new Transport.Response(
                                            200, gson.toJson(Map.of("tx_responses", txs, "total", String.valueOf(txs.size()))));
                                }
                                Object body = routes.get(path);
                                return body == null ? null : new Transport.Response(200, gson.toJson(body));
                            });
            return new RestClient("http://node", t);
        }
    }

    @Test
    void plansTheFirstBatchFromTheChainAndReproducesTheChainsRoots() {
        FakeNode node = new FakeNode();
        RestClient rest = node.rest();
        QledgerLedger ledger = new QledgerLedger();
        QledgerBatch.BatchPlan plan = QledgerBatch.planBatch(rest, node.chainId, node.rollupId, "qor1sub", ledger);
        assertEquals(node.head, plan.input.inboxEnd);
        assertEquals(0, plan.input.batchIndex);
        assertEquals(node.head, plan.input.txCount);
        assertEquals(Bytes.bytesToHex(QledgerTree.emptyRoot()), Bytes.bytesToHex(plan.input.prevStateRoot));
        assertEquals(Q.batch.stateRoot, Bytes.bytesToHex(plan.input.stateRoot));
        assertEquals(Q.batch.withdrawalsRoot, Bytes.bytesToHex(plan.input.withdrawalsRoot));
        assertEquals(node.range(node.head), Bytes.bytesToHex(plan.input.dataHash));
        assertEquals(2, plan.result.withdrawals.size());
        assertEquals(Q.batch.stateRoot, Bytes.bytesToHex(plan.ledger.root()));
        assertEquals(Bytes.bytesToHex(QledgerTree.emptyRoot()), Bytes.bytesToHex(ledger.root()), "input ledger untouched");
        assertTrue(node.urls.stream().anyMatch(u -> u.startsWith("/cosmos/tx/v1beta1/txs?query=rdk_data_posted.rollup_id")));

        node.routes.put("/qorechain/rdk/v1/submitter_bond/" + node.rollupId + "/qor1sub", Map.of("amount", "5", "pending", "0"));
        IllegalStateException e =
                assertThrows(
                        IllegalStateException.class,
                        () -> QledgerBatch.planBatch(rest, node.chainId, node.rollupId, "qor1sub", new QledgerLedger()));
        assertTrue(e.getMessage().contains("bond"));

        // A latest-batch read that fails with anything but 404 is not "no batch yet".
        node.routes.put("/qorechain/rdk/v1/submitter_bond/" + node.rollupId + "/qor1sub", Map.of("amount", "1000000000", "pending", "0"));
        node.failures.put("/qorechain/rdk/v1/latest_batch/" + node.rollupId, 503);
        RuntimeException down =
                assertThrows(
                        RuntimeException.class,
                        () -> QledgerBatch.planBatch(rest, node.chainId, node.rollupId, "qor1sub", new QledgerLedger()));
        assertTrue(down.getMessage().endsWith("failed: 503"));
    }

    @Test
    void readBatchFactsTreatsOnlyA404AsNotRetained() {
        FakeNode node = new FakeNode();
        RestClient rest = node.rest();
        node.routes.put(
                "/qorechain/rdk/v1/inbox/" + node.rollupId + "?inbox_end=3",
                Map.of("inbox", Map.of("head_sequence", String.valueOf(node.head), "range_data_hash", "ab".repeat(32))));
        BatchFacts f = QledgerBatch.readBatchFacts(rest, node.rollupId, "qor1sub", 3, 2);
        assertTrue(f.endRetained);
        assertEquals(Boolean.FALSE, f.nextRetained);
        assertEquals(1002L, f.inclusionHeight);
        node.routes.put("/qorechain/rdk/v1/posted_data/" + node.rollupId + "/4", Map.of("posted_data", Map.of("height", "203")));
        f = QledgerBatch.readBatchFacts(rest, node.rollupId, "qor1sub", 3, 2);
        assertEquals(Boolean.TRUE, f.nextRetained);
        assertEquals(203L, f.nextHeight);
        node.failures.put("/qorechain/rdk/v1/posted_data/" + node.rollupId + "/4", 500);
        assertThrows(RuntimeException.class, () -> QledgerBatch.readBatchFacts(rest, node.rollupId, "qor1sub", 3, 2));
    }

    @Test
    void fetchedEntriesAreCheckedAgainstTheChainsAccumulator() {
        FakeNode node = new FakeNode();
        RestClient rest = node.rest();
        // Post `to` no longer retained (404) and `to` is the head: checked against head_acc.
        List<QledgerEntry> got =
                QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, node.head, new byte[32]);
        assertEquals(ENTRIES.size(), got.size());
        for (int i = 0; i < got.size(); i++) {
            assertEquals(ENTRIES.get(i).height, got.get(i).height);
            assertEquals(ENTRIES.get(i).poster, got.get(i).poster);
            assertEquals(Bytes.bytesToHex(ENTRIES.get(i).payload), Bytes.bytesToHex(got.get(i).payload));
        }
        // Post `to` retained: checked against its inbox_acc.
        int to = node.head - 1;
        String postedTo = "/qorechain/rdk/v1/posted_data/" + node.rollupId + "/" + to;
        node.routes.put(postedTo, Map.of("posted_data", Map.of("sequence", String.valueOf(to), "inbox_acc", Bytes.bytesToHex(node.accs.get(to - 1)))));
        assertEquals(to, QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, to, new byte[32]).size());
        // A node whose index disagrees with the chain's accumulator is refused.
        node.routes.put(postedTo, Map.of("posted_data", Map.of("sequence", String.valueOf(to), "inbox_acc", "ab".repeat(32))));
        assertTrue(
                assertThrows(
                                IllegalStateException.class,
                                () -> QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, to, new byte[32]))
                        .getMessage()
                        .contains("do not match"));
        // Commitment gone and `to` is not the head: nothing to verify against, so refused.
        node.routes.remove(postedTo);
        assertTrue(
                assertThrows(
                                IllegalStateException.class,
                                () -> QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, to, new byte[32]))
                        .getMessage()
                        .contains("cannot be verified"));
        // Only a 404 means "not retained": any other error is rethrown.
        node.failures.put(postedTo, 500);
        RuntimeException err =
                assertThrows(
                        RuntimeException.class,
                        () -> QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, to, new byte[32]));
        assertTrue(err.getMessage().endsWith("failed: 500"));
        // The head accumulator disagrees.
        Map<String, Object> inbox = new LinkedHashMap<>();
        inbox.put("head_sequence", String.valueOf(node.head));
        inbox.put("head_acc", "cd".repeat(32));
        node.routes.put("/qorechain/rdk/v1/inbox/" + node.rollupId, Map.of("inbox", inbox));
        assertThrows(
                IllegalStateException.class,
                () -> QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, node.head, new byte[32]));
        // A missing entry is reported.
        node.posts.clear();
        assertTrue(
                assertThrows(
                                IllegalStateException.class,
                                () -> QledgerBatch.fetchEntries(rest, node.chainId, node.rollupId, 0, node.head, new byte[32]))
                        .getMessage()
                        .contains("was not found"));
    }

    @Test
    void submitBatchPreflightAppliesTheQledgerRules() {
        FakeNode node = new FakeNode();
        RdkTxClient client =
                new RdkTxClient(
                        Accounts.deriveNativeAccount(
                                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
                                        + " abandon about"),
                        node.chainId,
                        node.rest());
        SubmitBatchInput in = new SubmitBatchInput();
        in.sequencer = "qor1sub";
        in.rollupId = node.rollupId;
        in.stateRoot = new byte[32];
        in.dataHash = Bytes.hexToBytes(node.range(node.head));
        in.inboxEnd = node.head;
        client.preflightSubmitBatch(Messages.submitBatchMsg(in));

        node.routes.put("/qorechain/rdk/v1/submitter_bond/" + node.rollupId + "/qor1sub", Map.of("amount", "1000000000", "pending", "1024"));
        assertTrue(
                assertThrows(IllegalArgumentException.class, () -> client.preflightSubmitBatch(Messages.submitBatchMsg(in)))
                        .getMessage()
                        .contains("waiting for finality"));
    }
}
