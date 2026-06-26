package io.github.qorechain.rdk.config;

import io.github.qorechain.rdk.config.Enums.BatchStatus;
import io.github.qorechain.rdk.config.Enums.RollupStatus;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** Rollup and batch lifecycle state machines. */
public final class Lifecycle {
    private Lifecycle() {}

    /** A creator-initiated rollup lifecycle action. */
    public enum RollupAction {
        PAUSE("pause"),
        RESUME("resume"),
        STOP("stop");

        private final String wire;

        RollupAction(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }
    }

    /** Maps each rollup action to the statuses it is permitted from. */
    public static final Map<RollupAction, List<RollupStatus>> ROLLUP_ACTION_FROM;

    static {
        Map<RollupAction, List<RollupStatus>> m = new EnumMap<>(RollupAction.class);
        m.put(RollupAction.PAUSE, List.of(RollupStatus.ACTIVE));
        m.put(RollupAction.RESUME, List.of(RollupStatus.PAUSED));
        m.put(RollupAction.STOP, List.of(RollupStatus.ACTIVE, RollupStatus.PAUSED));
        ROLLUP_ACTION_FROM = m;
    }

    /** Whether a rollup action is allowed from the given status. */
    public static boolean canPerformRollupAction(RollupAction action, RollupStatus status) {
        return ROLLUP_ACTION_FROM.get(action).contains(status);
    }

    /** Throw {@link IllegalStateException} if a rollup action is not allowed from the given status. */
    public static void assertRollupAction(RollupAction action, RollupStatus status) {
        if (canPerformRollupAction(action, status)) {
            return;
        }
        String from =
                ROLLUP_ACTION_FROM.get(action).stream()
                        .map(RollupStatus::wire)
                        .collect(Collectors.joining(", "));
        if (from.isEmpty()) {
            from = "none";
        }
        throw new IllegalStateException(
                "cannot "
                        + action.wire()
                        + " a rollup in status \""
                        + (status == null ? "null" : status.wire())
                        + "\" (allowed from: "
                        + from
                        + ")");
    }

    /** The valid next states for each batch status. A finalized/rejected batch is terminal. */
    public static final Map<BatchStatus, List<BatchStatus>> BATCH_TRANSITIONS;

    static {
        Map<BatchStatus, List<BatchStatus>> m = new EnumMap<>(BatchStatus.class);
        m.put(BatchStatus.SUBMITTED, List.of(BatchStatus.FINALIZED, BatchStatus.CHALLENGED));
        m.put(BatchStatus.CHALLENGED, List.of(BatchStatus.REJECTED, BatchStatus.FINALIZED));
        m.put(BatchStatus.FINALIZED, List.of());
        m.put(BatchStatus.REJECTED, List.of());
        BATCH_TRANSITIONS = m;
    }

    /** Whether a batch status is terminal (finalized or rejected). */
    public static boolean isBatchFinal(BatchStatus status) {
        return BATCH_TRANSITIONS.get(status).isEmpty();
    }

    /** The Unix timestamp (seconds) at which an optimistic batch's challenge window closes. */
    public static long challengeWindowDeadline(long submittedAtSecs, long windowSecs) {
        return submittedAtSecs + windowSecs;
    }

    /** Whether an optimistic batch's challenge window has elapsed at {@code nowSecs}. */
    public static boolean isChallengeWindowClosed(long submittedAtSecs, long windowSecs, long nowSecs) {
        return nowSecs >= challengeWindowDeadline(submittedAtSecs, windowSecs);
    }
}
