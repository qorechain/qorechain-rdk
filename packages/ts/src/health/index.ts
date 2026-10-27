/**
 * Rollup health: a consolidated, beginner-friendly read of a rollup's status,
 * its latest settlement batch, and (for optimistic rollups) the challenge-window
 * countdown — assembled from the existing read surface.
 */
import type { RdkClient } from "../client/rdk-client";
import { MAX_PENDING_OPTIMISTIC_BATCHES } from "../rules";
import { FEATURE_RDK_CHALLENGE_SETTLEMENT } from "../transition";
import {
  batchChallengeWindow,
  type ChainTip,
  type ChallengeWindowStatus,
} from "../lifecycle/state-machine";

export interface RollupHealth {
  rollupId: string;
  /** Rollup lifecycle status (active/paused/stopped/pending). */
  status: string;
  /** Whether any batch has been submitted. */
  hasBatches: boolean;
  latestBatchIndex?: number;
  latestBatchStatus?: string;
  /** Height the latest batch was submitted at. */
  latestBatchHeight?: number;
  /** Blocks since the latest batch was submitted. */
  batchAgeBlocks?: number;
  /**
   * Seconds since the latest batch was submitted — only when the node records
   * the submission time (chain v3.2.4+); otherwise unknown, since a block
   * height cannot be turned into a time without the block.
   */
  batchAgeSecs?: number;
  /**
   * The latest batch's challenge window, computed with the chain's own rules
   * (see {@link batchChallengeWindow}). Present for a batch still pending.
   */
  challengeWindow?: ChallengeWindowStatus;
  /**
   * Time mode only: when the challenge window closes (Unix seconds). On the
   * block-count path see `challengeWindow.deadlineHeight` instead.
   */
  challengeDeadlineSecs?: number;
  /** Time mode only: seconds until the window closes (negative once past). */
  secondsUntilChallengeDeadline?: number;
  /**
   * From chain v3.2.5 (`rdk-challenge-settlement`) batches finalize in order:
   * a batch whose own window has passed still waits for every earlier batch.
   * Set when the latest batch could finalize on its own window but an earlier
   * batch is still submitted or challenged.
   */
  heldBackBy?: { batchIndex: number; status: string };
  /** Coarse health flag: active rollup, latest batch not rejected. */
  healthy: boolean;
  /** Human-readable observations. */
  notes: string[];
}

/**
 * The oldest batch before `latestIndex` that is still submitted or challenged.
 * At most {@link MAX_PENDING_OPTIMISTIC_BATCHES} batches can be waiting, so
 * the search starts that far back instead of at batch 0.
 */
async function oldestUnsettledBefore(
  client: RdkClient,
  rollupId: string,
  latestIndex: number,
): Promise<{ batchIndex: number; status: string } | undefined> {
  const batches = await client.rest.listBatches(rollupId, {
    startIndex: Math.max(0, latestIndex - MAX_PENDING_OPTIMISTIC_BATCHES),
  });
  const pending = batches
    .filter((b) => b.batchIndex < latestIndex && (b.status === "submitted" || b.status === "challenged"))
    .sort((a, b) => a.batchIndex - b.batchIndex);
  return pending[0] ? { batchIndex: pending[0].batchIndex, status: pending[0].status } : undefined;
}

/** Assemble a {@link RollupHealth} snapshot for a rollup. */
export async function getRollupHealth(
  client: RdkClient,
  rollupId: string,
  options: {
    /**
     * The chain tip to judge the window against. Defaults to the node's
     * `/status`. (`nowSecs` from earlier releases is still honoured as the tip
     * time, but cannot supply a height.)
     */
    tip?: ChainTip;
    nowSecs?: number;
    /**
     * The rollup's challenge window in seconds. Defaults to the value the node
     * reports for this rollup (chain v3.2.4+), then to the global
     * `default_challenge_window` param.
     */
    challengeWindowSecs?: number;
  } = {},
): Promise<RollupHealth> {
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
  health.latestBatchHeight = latestBatch.submittedAt;

  if (latestBatch.status === "rejected") {
    healthy = false;
    notes.push("latest batch was rejected");
  }

  // The tip is needed for the batch age and, for a pending batch, the window.
  let tip = options.tip;
  if (!tip) {
    try {
      tip = await client.getChainTip();
    } catch (err) {
      notes.push(`could not read the chain tip: ${(err as Error).message}`);
    }
  }
  if (tip && options.nowSecs !== undefined && !options.tip) {
    tip = { ...tip, timeSecs: options.nowSecs };
  }
  if (tip) {
    health.batchAgeBlocks = tip.height - latestBatch.submittedAt;
    if (latestBatch.submittedTime > 0) {
      health.batchAgeSecs = tip.timeSecs - latestBatch.submittedTime;
    }
  }

  if (latestBatch.status === "submitted" || latestBatch.status === "challenged") {
    const windowSecs =
      options.challengeWindowSecs ??
      rollup.challengeWindowSec ??
      (await client.params()).defaultChallengeWindow;
    if (tip) {
      const window = batchChallengeWindow(latestBatch, windowSecs, tip);
      health.challengeWindow = window;
      if (window.mode === "time") {
        health.challengeDeadlineSecs = window.deadlineSecs;
        health.secondsUntilChallengeDeadline = window.secondsRemaining;
      }
    }
    if (rollup.challengeWindowSec === undefined && options.challengeWindowSecs === undefined) {
      notes.push(
        "this node does not report the rollup's own challenge window; using the global default, which is wrong for a rollup that set its own",
      );
    }
    if (latestBatch.status === "challenged") {
      notes.push("latest batch is under challenge");
    }
    if (
      latestBatch.status === "submitted" &&
      health.challengeWindow?.finalizable &&
      (await client.rest.isProtocolFeatureEnabled(FEATURE_RDK_CHALLENGE_SETTLEMENT))
    ) {
      const blocker = await oldestUnsettledBefore(client, rollupId, latestBatch.batchIndex);
      if (blocker) {
        health.heldBackBy = blocker;
        notes.push(
          `batch ${latestBatch.batchIndex}'s window has passed, but batches finalize in order and batch ` +
            `${blocker.batchIndex} is still ${blocker.status}`,
        );
      }
    }
  }

  health.healthy = healthy;
  return health;
}
