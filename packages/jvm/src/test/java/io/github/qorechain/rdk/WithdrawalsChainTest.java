package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.bridge.Merkle;
import io.github.qorechain.rdk.bridge.Withdrawal;
import io.github.qorechain.rdk.bridge.Withdrawal.WithdrawalItem;
import io.github.qorechain.rdk.bridge.Withdrawal.WithdrawalLeafInput;
import io.github.qorechain.rdk.bridge.Withdrawal.WithdrawalProof;
import io.github.qorechain.rdk.bridge.Withdrawal.WithdrawalsTree;
import io.github.qorechain.rdk.client.ChallengeWindow.ChainTip;
import io.github.qorechain.rdk.client.Health;
import io.github.qorechain.rdk.client.Health.HealthOptions;
import io.github.qorechain.rdk.client.Health.RollupHealth;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views;
import io.github.qorechain.rdk.config.Networks.Endpoints;
import io.github.qorechain.rdk.da.Da;
import io.github.qorechain.rdk.rules.Rules;
import io.github.qorechain.rdk.transition.Transition;
import io.github.qorechain.rdk.tx.Messages.MsgSubmitBatch;
import io.github.qorechain.rdk.tx.RdkTxClient;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import io.github.qorechain.rdk.util.Bytes;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Withdrawals, exactly as the chain builds them, and the other chain v3.2.5 changes. Every proof in
 * the vectors is accepted by the chain's own VerifyWithdrawalMerkle, and refused at the wrong
 * index.
 */
class WithdrawalsChainTest {

    private static List<WithdrawalItem> items(Golden.WithdrawalTreeSection w) {
        List<WithdrawalItem> out = new ArrayList<>();
        for (Golden.WithdrawalEntry e : w.withdrawals) {
            out.add(new WithdrawalItem(e.recipient, w.denom, e.amount));
        }
        return out;
    }

    private static List<String> hex(List<byte[]> bs) {
        List<String> out = new ArrayList<>();
        for (byte[] b : bs) {
            out.add(Bytes.bytesToHex(b));
        }
        return out;
    }

    private static void checkTree(Transition.Version version, Golden.WithdrawalTreeVersion want) {
        Golden.WithdrawalTreeSection w = Golden.load().withdrawalTree;
        WithdrawalsTree tree = Withdrawal.withdrawalsTree(items(w), w.rollupId, version, w.chainId);
        assertEquals(want.leaves, hex(tree.leaves));
        assertEquals(want.root, Bytes.bytesToHex(tree.root));
        for (int i = 0; i < w.withdrawals.size(); i++) {
            WithdrawalProof p = tree.proof(i);
            assertEquals(want.proofs.get(i), hex(p.proof), "proof " + i);
            assertEquals(want.root, Bytes.bytesToHex(p.withdrawalsRoot));
            assertEquals(i, p.withdrawalIndex);
        }
    }

    @Test
    void v1LeavesRootAndEveryProofMatchTheChain() {
        checkTree(Transition.Version.V1, Golden.load().withdrawalTree.v1);
    }

    @Test
    void v2LeavesRootAndEveryProofMatchTheChain() {
        checkTree(Transition.Version.V2, Golden.load().withdrawalTree.v2);
    }

    @Test
    void singleLeavesMatchTheChainsFunctions() {
        Golden g = Golden.load();
        Golden.WithdrawalTreeSection w = g.withdrawalTree;
        WithdrawalLeafInput input = new WithdrawalLeafInput(w.rollupId, 0, "qor1alice", "uqor", 1_500_000);
        assertEquals(w.v1.leaves.get(0), Bytes.bytesToHex(Withdrawal.withdrawalLeafV1(input)));
        assertEquals(w.v2.leaves.get(0), Bytes.bytesToHex(Withdrawal.withdrawalLeafV2(w.chainId, input)));
        IllegalArgumentException e =
                assertThrows(IllegalArgumentException.class, () -> Withdrawal.withdrawalLeafV2("", input));
        assertTrue(e.getMessage().contains("chain id"));

        Golden.WithdrawalLeafSection l = g.withdrawalLeaf;
        WithdrawalLeafInput one =
                new WithdrawalLeafInput(l.rollupId, l.withdrawalIndex, l.recipient, l.denom, l.amount);
        assertEquals(l.v1, Bytes.bytesToHex(Withdrawal.withdrawalLeafV1(one)));
        assertEquals(l.v2, Bytes.bytesToHex(Withdrawal.withdrawalLeafV2(l.v2ChainId, one)));
    }

    @Test
    void v1AndV2TreesDifferSoAProofCannotCrossBindings() {
        Golden.WithdrawalTreeSection w = Golden.load().withdrawalTree;
        assertNotEquals(w.v1.root, w.v2.root);
    }

    @Test
    void anEmptyTreeIsRefused() {
        assertThrows(
                IllegalArgumentException.class,
                () -> Withdrawal.withdrawalsTree(List.of(), "roll", Transition.Version.V1, ""));
    }

    @Test
    void genericMerkleDefaultsAreTheChainsHash() {
        Golden g = Golden.load();
        List<byte[]> leaves = new ArrayList<>();
        for (String h : g.merkle.leavesHex) {
            leaves.add(Bytes.hexToBytes(h));
        }
        assertEquals(g.merkle.root, Bytes.bytesToHex(Merkle.binaryMerkleRoot(leaves, null)));
        assertEquals(g.merkle.proofIndex1Siblings, hex(Merkle.binaryMerkleProof(leaves, 1, null).siblings));
    }

    @Test
    void daBlobCommitmentIsTheChainsQorehash() {
        Golden.DaBlobSection d = Golden.load().daBlob;
        Da.DaBlob blob = Da.buildDaBlob(d.dataUtf8.getBytes(StandardCharsets.UTF_8));
        assertEquals("0x" + d.commitment, blob.dataHash);
        assertEquals(d.dataUtf8.length(), blob.size);
        assertThrows(IllegalArgumentException.class, () -> Da.buildDaBlob(new byte[11], 10));
    }

    @Test
    void withdrawalsRootIsEmptyOr32Bytes() {
        assertNull(Rules.withdrawalsRootError((byte[]) null));
        assertNull(Rules.withdrawalsRootError(""));
        assertNull(Rules.withdrawalsRootError(new byte[0]));
        assertNull(Rules.withdrawalsRootError(new byte[32]));
        assertNull(Rules.withdrawalsRootError("0x" + "ab".repeat(32)));
        assertTrue(Rules.withdrawalsRootError("ab".repeat(31)).contains("31"));
        assertEquals(
                "withdrawalsRoot must be empty or 32 bytes, got 33",
                Rules.withdrawalsRootError(new byte[33]));
    }

    @Test
    void aRollupWithAnUnsettledLatestBatchCannotBeStopped() {
        assertTrue(Rules.stopRollupError("submitted").contains("submitted"));
        assertTrue(Rules.stopRollupError("challenged").contains("challenged"));
        assertNull(Rules.stopRollupError("finalized"));
        assertNull(Rules.stopRollupError("rejected"));
        assertNull(Rules.stopRollupError(null));
        assertEquals(4096, Rules.MAX_PENDING_OPTIMISTIC_BATCHES);
        assertEquals("rdk-challenge-settlement", Transition.FEATURE_RDK_CHALLENGE_SETTLEMENT);
    }

    @Test
    void broadcastRefusesABadWithdrawalsRootBeforeSigning() {
        Account acc =
                Accounts.deriveNativeAccount(
                        "abandon abandon abandon abandon abandon abandon abandon abandon abandon"
                                + " abandon abandon about");
        int[] signed = {0};
        RdkTxClient tx =
                new RdkTxClient(acc, "qorechain-diana", null)
                        .withBackend(
                                (signer, messages, params) -> {
                                    signed[0]++;
                                    return Map.of("code", 0);
                                });
        MsgSubmitBatch bad = new MsgSubmitBatch();
        bad.sequencer = acc.address;
        bad.rollupId = "my-rollup";
        bad.batchIndex = 7;
        bad.withdrawalsRoot = new byte[31];
        IllegalArgumentException e =
                assertThrows(IllegalArgumentException.class, () -> tx.broadcast(List.of(bad), new TxParams()));
        assertTrue(e.getMessage().contains("cannot submit batch 7"));
        assertEquals(0, signed[0], "a refused batch still reached signing");

        bad.withdrawalsRoot = new byte[32];
        tx.broadcast(List.of(bad), new TxParams());
        bad.withdrawalsRoot = new byte[0];
        tx.broadcast(List.of(bad), new TxParams());
        assertEquals(2, signed[0]);
    }

    @Test
    void rollupViewMapsHasVerificationKey() {
        assertTrue(Views.mapRollupView(Map.of("has_verification_key", true)).hasVerificationKey);
        assertTrue(Views.mapRollupView(Map.of("hasVerificationKey", true)).hasVerificationKey);
        assertFalse(Views.mapRollupView(Map.of("has_verification_key", false)).hasVerificationKey);
        assertFalse(Views.mapRollupView(Map.of()).hasVerificationKey, "not served means none");
    }

    /**
     * A node whose latest batch (2) is past its own window while batch 0 is still challenged.
     * {@code settlement} says whether it reports {@code rdk-challenge-settlement} enabled.
     */
    private static RdkClient inOrderNode(boolean settlement, List<String> seen) {
        Transport t =
                req -> {
                    seen.add(req.url);
                    if (req.url.contains("/qorechain/rdk/v1/rollup/")) {
                        return new Transport.Response(
                                200,
                                "{\"rollup\":{\"rollup_id\":\"r1\",\"status\":\"active\",\"challenge_window_sec\":\"100\"}}");
                    }
                    if (req.url.contains("/qorechain/rdk/v1/latest_batch/")) {
                        return new Transport.Response(
                                200,
                                "{\"batch\":{\"batch_index\":2,\"status\":\"submitted\",\"submitted_at\":300,\"submitted_time\":1700000000}}");
                    }
                    if (req.url.contains("/qorechain/rdk/v1/batches/")) {
                        return new Transport.Response(
                                200,
                                "{\"batches\":["
                                        + "{\"batch_index\":0,\"status\":\"challenged\",\"submitted_at\":100},"
                                        + "{\"batch_index\":1,\"status\":\"submitted\",\"submitted_at\":200},"
                                        + "{\"batch_index\":2,\"status\":\"submitted\",\"submitted_at\":300}"
                                        + "],\"next_index\":\"0\"}");
                    }
                    if (req.url.contains("/qorechain/pqc/v1/protocol_features")) {
                        return new Transport.Response(
                                200,
                                "{\"features\":[{\"name\":\"rdk-challenge-settlement\",\"enabled\":"
                                        + settlement
                                        + "}]}");
                    }
                    return new Transport.Response(404, "{}");
                };
        RdkClient.Options o = new RdkClient.Options();
        o.transport = t;
        o.endpoints = new Endpoints("http://node", "http://node", "", "http://node");
        return new RdkClient(o);
    }

    @Test
    void healthReportsALatestBatchHeldBackByAnEarlierChallengedOne() {
        List<String> seen = new ArrayList<>();
        HealthOptions o = new HealthOptions();
        o.tip = new ChainTip(400, 1700000200);
        RollupHealth h = Health.getRollupHealth(inOrderNode(true, seen), "r1", o);
        assertTrue(h.challengeWindow.finalizable);
        assertNotNull(h.heldBackBy);
        assertEquals(0, h.heldBackBy.batchIndex);
        assertEquals("challenged", h.heldBackBy.status);
        assertTrue(
                h.notes.contains(
                        "batch 2's window has passed, but batches finalize in order and batch 0 is"
                                + " still challenged"),
                String.join(" | ", h.notes));
        // Batch 2 is fewer than 4096 batches in, so the search starts at batch 0.
        assertTrue(seen.stream().anyMatch(u -> u.endsWith("/qorechain/rdk/v1/batches/r1?limit=100")));
    }

    @Test
    void healthDoesNotReportHeldBackWhenTheFeatureIsOff() {
        List<String> seen = new ArrayList<>();
        HealthOptions o = new HealthOptions();
        o.tip = new ChainTip(400, 1700000200);
        RollupHealth h = Health.getRollupHealth(inOrderNode(false, seen), "r1", o);
        assertTrue(h.challengeWindow.finalizable);
        assertNull(h.heldBackBy);
        assertFalse(seen.stream().anyMatch(u -> u.contains("/qorechain/rdk/v1/batches/")));
    }
}
