package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.ChallengeWindow.ChainTip;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.RollupView;
import io.github.qorechain.rdk.rules.Rules;
import io.github.qorechain.rdk.transition.Transition;
import java.util.ArrayList;
import java.util.List;

/**
 * A consolidated, beginner-friendly read of a rollup's status, its latest settlement batch, and
 * (for optimistic rollups) the challenge window, judged with the chain's own rules — see {@link
 * ChallengeWindow}.
 */
public final class Health {
    private Health() {}

    /** A rollup health snapshot. */
    public static final class RollupHealth {
        public String rollupId;
        public String status;
        public boolean hasBatches;
        public int latestBatchIndex;
        public String latestBatchStatus;
        /** The height the latest batch was submitted at. */
        public int latestBatchHeight;
        /** Blocks since the latest batch was submitted (valid when {@link #hasTip}). */
        public long batchAgeBlocks;
        /**
         * Seconds since submission — valid only when the node records the submission time (chain
         * v3.2.4+, {@link #hasBatchAgeSecs}); a height alone cannot be turned into a time.
         */
        public long batchAgeSecs;
        public boolean hasBatchAgeSecs;
        /** The latest pending batch's window, by the chain's rules (valid when set). */
        public ChallengeWindow.Status challengeWindow;
        /** Time mode only: when the window closes (Unix seconds). */
        public long challengeDeadlineSecs;
        /** Time mode only: seconds until it closes (negative once past). */
        public long secondsUntilChallengeDeadline;
        public boolean hasChallengeWindow;
        /** Whether the chain tip could be read. */
        public boolean hasTip;
        /**
         * From chain v3.2.5 ({@code rdk-challenge-settlement}) batches finalize in order: a batch
         * whose own window has passed still waits for every earlier batch. Set (otherwise {@code
         * null}) when the latest batch could finalize on its own window but an earlier batch is
         * still submitted or challenged.
         */
        public HeldBack heldBackBy;
        public boolean healthy;
        public List<String> notes = new ArrayList<>();
    }

    /** The earlier batch a finalizable batch is waiting for. */
    public static final class HeldBack {
        public final int batchIndex;
        public final String status;

        public HeldBack(int batchIndex, String status) {
            this.batchIndex = batchIndex;
            this.status = status;
        }
    }

    /** Options for {@link #getRollupHealth}. */
    public static final class HealthOptions {
        /** The chain tip to judge against. {@code null} reads the node's {@code /status}. */
        public ChainTip tip;
        /**
         * When positive, overrides the tip's block time (it cannot supply a height). Kept from
         * earlier releases.
         */
        public long nowSecs;
        /**
         * The rollup's window in seconds. {@code null} uses the value the node reports for this
         * rollup (chain v3.2.4+), then the global param.
         */
        public Long challengeWindowSecs;
    }

    /** Assemble a {@link RollupHealth} snapshot for a rollup. */
    public static RollupHealth getRollupHealth(
            RdkClient client, String rollupId, HealthOptions options) {
        HealthOptions opts = options == null ? new HealthOptions() : options;
        RollupView rollup = client.rest.getRollup(rollupId);
        RollupHealth health = new RollupHealth();
        health.rollupId = rollupId;
        health.status = rollup.status;
        boolean healthy = "active".equals(rollup.status);
        if (!"active".equals(rollup.status)) {
            health.notes.add("rollup status is \"" + rollup.status + "\"");
        }
        health.healthy = healthy;

        BatchView latest;
        try {
            latest = client.rest.getLatestBatch(rollupId);
        } catch (RuntimeException e) {
            health.notes.add("no settlement batches submitted yet");
            return health;
        }
        if (latest.submittedAt == 0) {
            health.notes.add("no settlement batches submitted yet");
            return health;
        }

        health.hasBatches = true;
        health.latestBatchIndex = latest.batchIndex;
        health.latestBatchStatus = latest.status;
        health.latestBatchHeight = latest.submittedAt;

        if ("rejected".equals(latest.status)) {
            healthy = false;
            health.notes.add("latest batch was rejected");
        }

        ChainTip tip = opts.tip;
        if (tip == null) {
            try {
                tip = client.getChainTip();
            } catch (RuntimeException e) {
                health.notes.add("could not read the chain tip: " + e.getMessage());
            }
            if (tip != null && opts.nowSecs > 0) {
                tip = new ChainTip(tip.height, opts.nowSecs);
            }
        }
        if (tip != null) {
            health.hasTip = true;
            health.batchAgeBlocks = tip.height - latest.submittedAt;
            if (latest.submittedTime > 0) {
                health.batchAgeSecs = tip.timeSecs - latest.submittedTime;
                health.hasBatchAgeSecs = true;
            }
        }

        if ("submitted".equals(latest.status) || "challenged".equals(latest.status)) {
            boolean fellBack = opts.challengeWindowSecs == null && rollup.challengeWindowSec == null;
            Long windowSecs =
                    opts.challengeWindowSecs != null ? opts.challengeWindowSecs : rollup.challengeWindowSec;
            if (windowSecs == null) {
                try {
                    windowSecs = (long) client.params().defaultChallengeWindow;
                } catch (RuntimeException ignored) {
                    // no window can be computed without it
                }
            }
            if (tip != null && windowSecs != null) {
                ChallengeWindow.Status w = ChallengeWindow.of(latest, windowSecs, tip);
                health.challengeWindow = w;
                health.hasChallengeWindow = true;
                if ("time".equals(w.mode)) {
                    health.challengeDeadlineSecs = w.deadlineSecs;
                    health.secondsUntilChallengeDeadline = w.secondsRemaining;
                }
            }
            if (fellBack) {
                health.notes.add(
                        "this node does not report the rollup's own challenge window; using the"
                                + " global default, which is wrong for a rollup that set its own");
            }
            if ("challenged".equals(latest.status)) {
                health.notes.add("latest batch is under challenge");
            }
            if ("submitted".equals(latest.status)
                    && health.challengeWindow != null
                    && health.challengeWindow.finalizable
                    && client.rest.isProtocolFeatureEnabled(
                            Transition.FEATURE_RDK_CHALLENGE_SETTLEMENT)) {
                HeldBack blocker = oldestUnsettledBefore(client, rollupId, latest.batchIndex);
                if (blocker != null) {
                    health.heldBackBy = blocker;
                    health.notes.add(
                            "batch "
                                    + latest.batchIndex
                                    + "'s window has passed, but batches finalize in order and batch "
                                    + blocker.batchIndex
                                    + " is still "
                                    + blocker.status);
                }
            }
        }

        health.healthy = healthy;
        return health;
    }

    /**
     * The oldest batch before {@code latestIndex} that is still submitted or challenged, or {@code
     * null}. At most {@link Rules#MAX_PENDING_OPTIMISTIC_BATCHES} batches can be waiting, so the
     * search starts that far back instead of at batch 0.
     */
    private static HeldBack oldestUnsettledBefore(RdkClient client, String rollupId, int latestIndex) {
        long start = Math.max(0L, (long) latestIndex - Rules.MAX_PENDING_OPTIMISTIC_BATCHES);
        BatchView oldest = null;
        for (BatchView b : client.rest.listBatchesFrom(rollupId, start)) {
            if (b.batchIndex < latestIndex
                    && ("submitted".equals(b.status) || "challenged".equals(b.status))
                    && (oldest == null || b.batchIndex < oldest.batchIndex)) {
                oldest = b;
            }
        }
        return oldest == null ? null : new HeldBack(oldest.batchIndex, oldest.status);
    }
}
