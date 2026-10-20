/**
 * Client-side awareness of the rollup and settlement-batch lifecycles, so
 * invalid transitions are caught before a transaction is broadcast.
 *
 * Rollup: `pending → active → paused → stopped` (creator-only pause/resume/stop).
 * Batch: `submitted → finalized`, with `submitted → challenged → rejected` (and
 * `challenged → finalized` when a challenge is dismissed) on the optimistic path.
 */
import type { BatchStatus, RollupStatus } from "../config/enums";

/** A creator-initiated rollup lifecycle action. */
export type RollupAction = "pause" | "resume" | "stop";

/** The statuses from which each rollup action is permitted. */
export const ROLLUP_ACTION_FROM: Record<RollupAction, readonly RollupStatus[]> = {
  pause: ["active"],
  resume: ["paused"],
  stop: ["active", "paused"],
};

/** Whether a rollup action is allowed from the given status. */
export function canPerformRollupAction(action: RollupAction, status: RollupStatus): boolean {
  return ROLLUP_ACTION_FROM[action].includes(status);
}

/** Throw if a rollup action is not allowed from the given status. */
export function assertRollupAction(action: RollupAction, status: RollupStatus): void {
  if (!canPerformRollupAction(action, status)) {
    throw new Error(
      `cannot ${action} a rollup in status "${status}" ` +
        `(allowed from: ${ROLLUP_ACTION_FROM[action].join(", ") || "none"})`,
    );
  }
}

/** The valid next states for each batch status. A finalized/rejected batch is terminal. */
export const BATCH_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  submitted: ["finalized", "challenged"],
  challenged: ["rejected", "finalized"],
  finalized: [],
  rejected: [],
};

/** Whether a batch status is terminal (finalized or rejected). */
export function isBatchFinal(status: BatchStatus): boolean {
  return BATCH_TRANSITIONS[status].length === 0;
}

/**
 * The Unix timestamp (seconds) at which an optimistic batch's challenge window
 * closes, given when it was submitted and the window length in seconds.
 */
export function challengeWindowDeadline(submittedAtSecs: number, windowSecs: number): number {
  return submittedAtSecs + windowSecs;
}

/** Whether an optimistic batch's challenge window has elapsed at `nowSecs`. */
export function isChallengeWindowClosed(
  submittedAtSecs: number,
  windowSecs: number,
  nowSecs: number,
): boolean {
  return nowSecs >= challengeWindowDeadline(submittedAtSecs, windowSecs);
}

/**
 * The challenge-window state of one settlement batch, computed with the
 * chain's own rules (`x/rdk` `challenge_window.go`).
 *
 * The chain measures the window two ways, chosen **per batch**:
 *
 * - **`time`** — a batch submitted under the time-based window (chain v3.2.4,
 *   `rdk-challenge-window-time`) records its submission block time. Its window
 *   closes once block time reaches `submittedTime + windowSecs`.
 * - **`blocks`** — every earlier batch keeps the original rule:
 *   `windowSecs / 6` blocks counted from the submission **height**. That rule
 *   assumed 6-second blocks; real blocks are about 3.2 s on mainnet and 1 s on
 *   the testnet, so a 7-day window there closes after about 3.75 days and 28
 *   hours respectively.
 *
 * On the `blocks` path the chain refuses a challenge once
 * `height - submittedAt > windowBlocks`, but allows finalization once
 * `height - submittedAt >= windowBlocks` — so for exactly one block a batch is
 * both finalizable and still challengeable. Both are reported separately.
 */
export interface ChallengeWindowStatus {
  /** Which rule the chain applies to this batch. */
  mode: "time" | "blocks";
  /** Whether the chain still accepts a challenge against the batch now. */
  open: boolean;
  /** Whether the chain would finalize the batch now (its window has run). */
  finalizable: boolean;
  /** `time` mode: when the window closes (Unix seconds). */
  deadlineSecs?: number;
  /** `time` mode: seconds until it closes (negative once closed). */
  secondsRemaining?: number;
  /** `blocks` mode: the window's length in blocks. */
  windowBlocks?: number;
  /** `blocks` mode: the last height at which a challenge is accepted. */
  deadlineHeight?: number;
  /** `blocks` mode: blocks until that height (negative once closed). */
  blocksRemaining?: number;
}

/** The chain tip a challenge window is judged against. */
export interface ChainTip {
  height: number;
  /** Block time of the tip, Unix seconds. */
  timeSecs: number;
}

/**
 * Compute a batch's challenge window exactly as the chain does. `windowSecs`
 * is the **rollup's own** window: the chain uses each rollup's configured
 * value, and the global `default_challenge_window` param is only a fallback.
 */
export function batchChallengeWindow(
  batch: { submittedAt: number; submittedTime?: number },
  windowSecs: number,
  tip: ChainTip,
): ChallengeWindowStatus {
  const submittedTime = batch.submittedTime ?? 0;
  if (submittedTime > 0) {
    const elapsed = tip.timeSecs - submittedTime;
    // The chain treats a negative elapsed (tip before submission) as not elapsed.
    const elapsedFully = elapsed >= 0 && elapsed >= windowSecs;
    const deadlineSecs = submittedTime + windowSecs;
    return {
      mode: "time",
      open: !elapsedFully,
      finalizable: elapsedFully,
      deadlineSecs,
      secondsRemaining: deadlineSecs - tip.timeSecs,
    };
  }
  const windowBlocks = Math.floor(windowSecs / 6);
  const sinceSubmit = tip.height - batch.submittedAt;
  const deadlineHeight = batch.submittedAt + windowBlocks;
  return {
    mode: "blocks",
    open: sinceSubmit <= windowBlocks,
    finalizable: sinceSubmit >= windowBlocks,
    windowBlocks,
    deadlineHeight,
    blocksRemaining: deadlineHeight - tip.height,
  };
}
