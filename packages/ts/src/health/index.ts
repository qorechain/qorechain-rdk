/**
 * Rollup health: a consolidated, beginner-friendly read of a rollup's status,
 * its latest settlement batch, and (for optimistic rollups) the challenge-window
 * countdown — assembled from the existing read surface.
 */
import type { RdkClient } from "../client/rdk-client";

export interface RollupHealth {
  rollupId: string;
  /** Rollup lifecycle status (active/paused/stopped/pending). */
  status: string;
  /** Whether any batch has been submitted. */
  hasBatches: boolean;
  latestBatchIndex?: number;
  latestBatchStatus?: string;
  /** Seconds since the latest batch was submitted. */
  batchAgeSecs?: number;
  /** For optimistic batches: when the challenge window closes (unix seconds). */
  challengeDeadlineSecs?: number;
  /** Seconds until the challenge window closes (negative if already past). */
  secondsUntilChallengeDeadline?: number;
  /** Coarse health flag: active rollup, latest batch not rejected. */
  healthy: boolean;
  /** Human-readable observations. */
  notes: string[];
}

/** Assemble a {@link RollupHealth} snapshot for a rollup. */
export async function getRollupHealth(
  client: RdkClient,
  rollupId: string,
  options: { nowSecs?: number } = {},
): Promise<RollupHealth> {
  const nowSecs = options.nowSecs ?? Math.floor(Date.now() / 1000);
  const notes: string[] = [];

  const rollup = await client.rest.getRollup(rollupId);
  let healthy = rollup.status === "active";
  if (rollup.status !== "active") {
    notes.push(`rollup status is "${rollup.status}"`);
  }

  const health: RollupHealth = {
    rollupId,
    status: rollup.status,
    hasBatches: false,
    healthy,
    notes,
  };

  let latestBatch;
  try {
    latestBatch = await client.rest.getLatestBatch(rollupId);
  } catch {
    notes.push("no settlement batches submitted yet");
    return health;
  }
  if (!latestBatch || latestBatch.submittedAt === 0) {
    notes.push("no settlement batches submitted yet");
    return health;
  }

  health.hasBatches = true;
  health.latestBatchIndex = latestBatch.batchIndex;
  health.latestBatchStatus = latestBatch.status;
  health.batchAgeSecs = nowSecs - latestBatch.submittedAt;

  if (latestBatch.status === "rejected") {
    healthy = false;
    notes.push("latest batch was rejected");
  }

  if (latestBatch.status === "submitted" || latestBatch.status === "challenged") {
    const params = await client.params();
    const deadline = latestBatch.submittedAt + params.defaultChallengeWindow;
    health.challengeDeadlineSecs = deadline;
    health.secondsUntilChallengeDeadline = deadline - nowSecs;
    if (latestBatch.status === "challenged") {
      notes.push("latest batch is under challenge");
    }
  }

  health.healthy = healthy;
  return health;
}
