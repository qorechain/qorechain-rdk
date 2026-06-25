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
