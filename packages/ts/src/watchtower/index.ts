/**
 * Watchtower — an auto-challenger framework for optimistic rollups.
 *
 * It polls a rollup's settlement batches, surfaces each new batch and its
 * challenge-window deadline, and (when you supply a validity predicate) flags
 * batches you should challenge before the window closes. The kit does NOT
 * decide validity for you — only you know your rollup's expected state. Wire
 * `onInvalid` to your `challengeBatch` call to close the loop.
 */
import type { RdkClient } from "../client/rdk-client";
import type { BatchView } from "../client/views";

/** A batch paired with its computed challenge-window deadline (unix seconds). */
export interface BatchDeadline {
  batch: BatchView;
  /** Unix seconds when the challenge window closes (0 if unknown). */
  deadline: number;
  /** Seconds remaining until the deadline (negative if passed). */
  secondsRemaining: number;
}

export interface WatchtowerOptions {
  /** Poll interval in milliseconds. Default 5000. */
  intervalMs?: number;
  /** Abort the watch when this signal fires. */
  signal?: AbortSignal;
  /** Called once per newly-observed batch. */
  onBatch?: (batch: BatchView) => void;
  /**
   * Your validity predicate. Return `false` (or a rejecting promise resolving
   * false) to mark the batch challengeable. If omitted, no batch is challenged.
   */
  validate?: (batch: BatchView) => boolean | Promise<boolean>;
  /** Called when `validate` returns false — wire this to `challengeBatch`. */
  onInvalid?: (info: BatchDeadline) => void;
  /** Called when a still-challengeable batch is nearing its deadline. */
  onDeadline?: (info: BatchDeadline) => void;
  /** Warn when a batch is within this many seconds of its deadline. Default 300. */
  deadlineWarnSecs?: number;
  /** Called on a polling error (the loop continues). */
  onError?: (error: unknown) => void;
  /** Override the clock (unix seconds), for testing. */
  nowSecs?: () => number;
}

export interface WatchtowerHandle {
  /** Stop polling. */
  stop: () => void;
}

const nowDefault = (): number => Math.floor(Date.now() / 1000);

/**
 * Start a watchtower over `rollupId`. Returns a handle with `stop()`; also stops
 * on the optional AbortSignal. Re-emits only batches it hasn't seen before.
 */
export function watchBatches(
  client: RdkClient,
  rollupId: string,
  options: WatchtowerOptions,
): WatchtowerHandle {
  const intervalMs = options.intervalMs ?? 5000;
  const warnSecs = options.deadlineWarnSecs ?? 300;
  const now = options.nowSecs ?? nowDefault;
  const seen = new Set<number>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let challengeWindow = 0;

  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };

  const deadlineFor = (batch: BatchView): BatchDeadline => {
    const deadline = challengeWindow > 0 && batch.submittedAt > 0
      ? batch.submittedAt + challengeWindow
      : 0;
    return { batch, deadline, secondsRemaining: deadline > 0 ? deadline - now() : 0 };
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (challengeWindow === 0) {
        const params = await client.rest.getParams();
        challengeWindow = params.defaultChallengeWindow ?? 0;
      }
      const batches = await client.rest.listBatches(rollupId);
      for (const batch of batches) {
        if (seen.has(batch.batchIndex)) continue;
        seen.add(batch.batchIndex);
        if (stopped) return;
        options.onBatch?.(batch);

        const info = deadlineFor(batch);
        const finalized = batch.status === "finalized" || batch.finalizedAt > 0;
        if (!finalized && options.validate) {
          const ok = await options.validate(batch);
          if (!ok && !stopped) options.onInvalid?.(info);
        }
        if (!finalized && info.deadline > 0 && info.secondsRemaining <= warnSecs && !stopped) {
          options.onDeadline?.(info);
        }
      }
    } catch (error) {
      if (!stopped) options.onError?.(error);
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  if (options.signal) {
    if (options.signal.aborted) return { stop };
    options.signal.addEventListener("abort", stop, { once: true });
  }
  void tick();
  return { stop };
}
