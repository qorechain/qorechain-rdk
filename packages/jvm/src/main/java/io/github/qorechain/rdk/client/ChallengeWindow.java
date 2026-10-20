package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Views.BatchView;

/**
 * Challenge windows, computed with the chain's own rules ({@code x/rdk challenge_window.go}).
 *
 * <p>The chain chooses the rule <b>per batch</b>. A batch submitted under the time-based window
 * (chain v3.2.4, {@code rdk-challenge-window-time}) records its submission block time, and its
 * window closes once block time reaches {@code submittedTime + windowSecs}. Every earlier batch
 * keeps the original rule: {@code windowSecs / 6} blocks counted from the submission <b>height</b>
 * — which assumed 6-second blocks, so a 7-day window closes after about 3.75 days on mainnet and
 * 28 hours on the testnet.
 *
 * <p>On the block-count path the chain refuses a challenge once {@code height - submittedAt >
 * windowBlocks} but finalizes once it is {@code >=}, so for exactly one block a batch is both
 * finalizable and still challengeable; {@link Status#open} and {@link Status#finalizable} report
 * the two separately.
 */
public final class ChallengeWindow {
    private ChallengeWindow() {}

    /** The chain tip a challenge window is judged against. */
    public static final class ChainTip {
        public final long height;
        /** The tip's block time, Unix seconds. */
        public final long timeSecs;

        public ChainTip(long height, long timeSecs) {
            this.height = height;
            this.timeSecs = timeSecs;
        }
    }

    /** A batch's challenge window, exactly as the chain judges it. */
    public static final class Status {
        /** {@code "time"} or {@code "blocks"}. */
        public String mode;
        public boolean open;
        public boolean finalizable;
        /** Time mode: when the window closes (Unix seconds). */
        public long deadlineSecs;
        /** Time mode: seconds until it closes (negative once closed). */
        public long secondsRemaining;
        /** Block-count mode: the window's length in blocks. */
        public long windowBlocks;
        /** Block-count mode: the last height at which a challenge is accepted. */
        public long deadlineHeight;
        /** Block-count mode: blocks until that height (negative once closed). */
        public long blocksRemaining;
    }

    /**
     * Compute a batch's challenge window as the chain does. {@code windowSecs} is the <b>rollup's
     * own</b> window; the global {@code default_challenge_window} param is only a fallback.
     */
    public static Status of(BatchView batch, long windowSecs, ChainTip tip) {
        Status s = new Status();
        if (batch.submittedTime > 0) {
            long elapsed = tip.timeSecs - batch.submittedTime;
            // The chain treats a negative elapsed (tip before submission) as not elapsed.
            boolean elapsedFully = elapsed >= 0 && elapsed >= windowSecs;
            s.mode = "time";
            s.open = !elapsedFully;
            s.finalizable = elapsedFully;
            s.deadlineSecs = batch.submittedTime + windowSecs;
            s.secondsRemaining = s.deadlineSecs - tip.timeSecs;
            return s;
        }
        long windowBlocks = windowSecs / 6;
        long since = tip.height - batch.submittedAt;
        s.mode = "blocks";
        s.open = since <= windowBlocks;
        s.finalizable = since >= windowBlocks;
        s.windowBlocks = windowBlocks;
        s.deadlineHeight = batch.submittedAt + windowBlocks;
        s.blocksRemaining = s.deadlineHeight - tip.height;
        return s;
    }
}
