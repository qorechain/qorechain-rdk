package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.client.Views.RollupView;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * A consolidated, beginner-friendly read of a rollup's status, its latest settlement batch, and (for
 * optimistic rollups) the challenge-window countdown.
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
        public long batchAgeSecs;
        public long challengeDeadlineSecs;
        public long secondsUntilChallengeDeadline;
        public boolean hasChallengeWindow;
        public boolean healthy;
        public List<String> notes = new ArrayList<>();
    }

    /** Options for {@link #getRollupHealth}. {@code nowSecs <= 0} uses the wall clock. */
    public static final class HealthOptions {
        public long nowSecs;
    }

    /** Assemble a {@link RollupHealth} snapshot for a rollup. */
    public static RollupHealth getRollupHealth(
            RdkClient client, String rollupId, HealthOptions options) {
        long nowSecs = (options != null && options.nowSecs > 0) ? options.nowSecs : Instant.now().getEpochSecond();

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
        health.batchAgeSecs = nowSecs - latest.submittedAt;

        if ("rejected".equals(latest.status)) {
            healthy = false;
            health.notes.add("latest batch was rejected");
        }

        if ("submitted".equals(latest.status) || "challenged".equals(latest.status)) {
            try {
                ParamsView params = client.params();
                long deadline = (long) latest.submittedAt + params.defaultChallengeWindow;
                health.challengeDeadlineSecs = deadline;
                health.secondsUntilChallengeDeadline = deadline - nowSecs;
                health.hasChallengeWindow = true;
                if ("challenged".equals(latest.status)) {
                    health.notes.add("latest batch is under challenge");
                }
            } catch (RuntimeException ignored) {
                // leave challenge-window fields unset when params are unavailable
            }
        }

        health.healthy = healthy;
        return health;
    }
}
