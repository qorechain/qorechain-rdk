package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.ChallengeWindow;
import io.github.qorechain.rdk.client.ChallengeWindow.ChainTip;
import io.github.qorechain.rdk.client.Health;
import io.github.qorechain.rdk.client.Health.HealthOptions;
import io.github.qorechain.rdk.client.Health.RollupHealth;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views;
import io.github.qorechain.rdk.config.Networks.Endpoints;
import io.github.qorechain.rdk.rules.Rules;
import io.github.qorechain.rdk.tx.Messages.MsgExecuteWithdrawal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Health, the challenge window, and the client-side chain rules. Java had no tests for any of
 * these before 0.6.0, which is how the health monitor came to read a block height as a Unix
 * timestamp. The rule vectors are ported verbatim from the chain's own tests at v3.2.3.
 */
class HealthAndRulesTest {

    /** A node serving a rollup, its latest batch, params and (optionally) a chain tip. */
    private static RdkClient node(String rollup, String batch, String status, List<String> seen) {
        Transport t =
                req -> {
                    seen.add(req.url);
                    if (req.url.contains("/qorechain/rdk/v1/params")) {
                        return new Transport.Response(200, "{\"params\":{\"default_challenge_window\":604800}}");
                    }
                    if (req.url.contains("/qorechain/rdk/v1/rollup/")) {
                        return new Transport.Response(200, rollup);
                    }
                    if (req.url.contains("/qorechain/rdk/v1/latest_batch/")) {
                        return new Transport.Response(200, batch);
                    }
                    if (req.url.endsWith("/status") && status != null) {
                        return new Transport.Response(200, status);
                    }
                    return new Transport.Response(404, "{}");
                };
        RdkClient.Options o = new RdkClient.Options();
        o.transport = t;
        o.endpoints = new Endpoints("http://node", "http://node", "", "http://node");
        return new RdkClient(o);
    }

    private static final String ACTIVE = "{\"rollup\":{\"rollup_id\":\"r1\",\"status\":\"active\"}}";

    @Test
    void blockCountWindowReadsSubmittedAtAsAHeight() {
        // submitted_at is a BLOCK HEIGHT. Before 0.6.0 the health monitor subtracted it from the
        // clock and added the window in seconds to it.
        List<String> seen = new ArrayList<>();
        RdkClient c =
                node(
                        ACTIVE,
                        "{\"batch\":{\"batch_index\":3,\"status\":\"submitted\",\"submitted_at\":1000}}",
                        "{\"result\":{\"sync_info\":{\"latest_block_height\":\"1500\",\"latest_block_time\":\"2023-11-14T22:13:20.123456789Z\"}}}",
                        seen);
        RollupHealth h = Health.getRollupHealth(c, "r1", new HealthOptions());
        assertTrue(h.hasBatches && h.hasTip);
        assertEquals(1000, h.latestBatchHeight);
        assertEquals(500, h.batchAgeBlocks);
        assertFalse(h.hasBatchAgeSecs, "no submission time recorded, so seconds are unknown");
        ChallengeWindow.Status w = h.challengeWindow;
        assertEquals("blocks", w.mode);
        assertEquals(604800 / 6, w.windowBlocks);
        assertEquals(1000 + 100800, w.deadlineHeight);
        assertEquals(1000 + 100800 - 1500, w.blocksRemaining);
        assertTrue(w.open && !w.finalizable);
        // And it read the chain's LatestBatch route, not the old /batches/{id}?latest=true.
        assertTrue(seen.stream().anyMatch(u -> u.endsWith("/qorechain/rdk/v1/latest_batch/r1")));
    }

    @Test
    void timeWindowWhenTheSubmissionTimeIsRecorded() {
        RdkClient c =
                node(
                        ACTIVE,
                        "{\"batch\":{\"batch_index\":4,\"status\":\"submitted\",\"submitted_at\":2000,\"submitted_time\":1700000000}}",
                        null,
                        new ArrayList<>());
        HealthOptions o = new HealthOptions();
        o.tip = new ChainTip(2100, 1700000100);
        RollupHealth h = Health.getRollupHealth(c, "r1", o);
        assertTrue(h.hasBatchAgeSecs);
        assertEquals(100, h.batchAgeSecs);
        assertEquals("time", h.challengeWindow.mode);
        assertEquals(1700000000L + 604800, h.challengeDeadlineSecs);
        assertEquals(604800 - 100, h.secondsUntilChallengeDeadline);
    }

    @Test
    void usesTheRollupsOwnWindowOverTheGlobalDefault() {
        RdkClient c =
                node(
                        "{\"rollup\":{\"rollup_id\":\"r1\",\"status\":\"active\",\"challenge_window_sec\":3600}}",
                        "{\"batch\":{\"batch_index\":1,\"status\":\"submitted\",\"submitted_at\":1000}}",
                        null,
                        new ArrayList<>());
        HealthOptions o = new HealthOptions();
        o.tip = new ChainTip(1000, 0);
        RollupHealth h = Health.getRollupHealth(c, "r1", o);
        assertEquals(600, h.challengeWindow.windowBlocks);
        assertFalse(h.notes.stream().anyMatch(n -> n.contains("global default")));
    }

    @Test
    void windowBoundaryMatchesTheChain() {
        Views.BatchView b = new Views.BatchView();
        b.submittedAt = 1000;
        // At exactly windowBlocks the chain finalizes AND still accepts a challenge.
        ChallengeWindow.Status at = ChallengeWindow.of(b, 600, new ChainTip(1100, 0));
        assertTrue(at.finalizable && at.open);
        ChallengeWindow.Status past = ChallengeWindow.of(b, 600, new ChainTip(1101, 0));
        assertTrue(past.finalizable && !past.open);
    }

    @Test
    void chainTipParsesNodeStatus() {
        RdkClient c =
                node(
                        ACTIVE,
                        "{}",
                        "{\"result\":{\"sync_info\":{\"latest_block_height\":\"1500\",\"latest_block_time\":\"2023-11-14T22:13:20.123456789Z\"}}}",
                        new ArrayList<>());
        ChainTip tip = c.getChainTip();
        assertEquals(1500, tip.height);
        assertEquals(1700000000L, tip.timeSecs);
    }

    @Test
    void rollupIdGrammarMatchesTheChain() {
        String[] good = {
            "abc", "a1b", "0rollup", "my-rollup", "my_rollup", "my.rollup", "r--", "victim",
            "a".repeat(64), "9.9.9"
        };
        String[] bad = {
            "", "ab", "a".repeat(65), "victim/x", "Victim", "ROLL", "-abc", ".abc", "_abc",
            "has space", "tab\tid", "nul\u0000id", "new\nline", "é-rollup", "rollup✓", "a/b",
            "a\\b", "a:b", "a+b", "a%2fb"
        };
        for (String id : good) {
            assertNull(Rules.rollupIdError(id), id + " refused");
        }
        for (String id : bad) {
            assertNotNull(Rules.rollupIdError(id), id + " accepted");
        }
        // Length is in bytes, as the chain measures it.
        assertNotNull(Rules.rollupIdError("a".repeat(63) + "é"));
    }

    private static MsgExecuteWithdrawal goodWithdrawal() {
        MsgExecuteWithdrawal m = new MsgExecuteWithdrawal();
        m.submitter = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h";
        m.recipient = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h";
        m.rollupId = "roll-1";
        m.denom = Rules.ROLLUP_ESCROW_DENOM;
        m.amount = 1;
        m.proof = new ArrayList<>(List.of(new byte[32], new byte[32]));
        return m;
    }

    @Test
    void withdrawalRulesMatchTheChain() {
        assertTrue(Rules.withdrawalErrors(goodWithdrawal()).isEmpty());
        List<java.util.function.Consumer<MsgExecuteWithdrawal>> breaks =
                List.of(
                        m -> m.submitter = "nope",
                        m -> m.rollupId = "",
                        m -> m.recipient = "nope",
                        m -> m.denom = "uatom",
                        m -> m.amount = 0,
                        m -> m.amount = -5,
                        m -> m.proof = new ArrayList<>(List.of(new byte[] {1, 2, 3})),
                        m -> {
                            m.proof = new ArrayList<>();
                            for (int i = 0; i <= Rules.MAX_WITHDRAWAL_PROOF_DEPTH; i++) {
                                m.proof.add(new byte[32]);
                            }
                        });
        for (java.util.function.Consumer<MsgExecuteWithdrawal> b : breaks) {
            MsgExecuteWithdrawal m = goodWithdrawal();
            b.accept(m);
            assertFalse(Rules.withdrawalErrors(m).isEmpty());
        }
        MsgExecuteWithdrawal legacy = goodWithdrawal();
        legacy.rollupId = "Legacy/ID"; // ids from before v3.2.2 are not held to the grammar
        assertTrue(Rules.withdrawalErrors(legacy).isEmpty());
    }

    @Test
    void broadcastRefusesBeforeSigning() {
        io.github.qorechain.rdk.accounts.Account acc =
                io.github.qorechain.rdk.accounts.Accounts.deriveNativeAccount(
                        "abandon abandon abandon abandon abandon abandon abandon abandon abandon"
                                + " abandon abandon about");
        int[] signed = {0};
        io.github.qorechain.rdk.tx.RdkTxClient tx =
                new io.github.qorechain.rdk.tx.RdkTxClient(acc, "qorechain-diana", null)
                        .withBackend(
                                (signer, messages, params) -> {
                                    signed[0]++;
                                    return Map.of("code", 0);
                                });

        io.github.qorechain.rdk.tx.Messages.MsgCreateRollup bad =
                new io.github.qorechain.rdk.tx.Messages.MsgCreateRollup();
        bad.creator = acc.address;
        bad.rollupId = "My/Rollup";
        assertThrows(
                IllegalArgumentException.class,
                () -> tx.broadcast(List.of(bad), new io.github.qorechain.rdk.tx.TxBackend.TxParams()));

        MsgExecuteWithdrawal w = goodWithdrawal();
        w.denom = "uatom";
        assertThrows(
                IllegalArgumentException.class,
                () -> tx.broadcast(List.of(w), new io.github.qorechain.rdk.tx.TxBackend.TxParams()));
        assertEquals(0, signed[0], "refused messages still reached signing");

        io.github.qorechain.rdk.tx.Messages.MsgCreateRollup good =
                new io.github.qorechain.rdk.tx.Messages.MsgCreateRollup();
        good.creator = acc.address;
        good.rollupId = "my-rollup";
        tx.broadcast(List.of(good), new io.github.qorechain.rdk.tx.TxBackend.TxParams());
        assertEquals(1, signed[0]);
    }
}
