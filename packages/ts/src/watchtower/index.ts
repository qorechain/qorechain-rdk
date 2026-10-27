/**
 * Watchtower — an auto-challenger framework for optimistic rollups.
 *
 * It polls a rollup's settlement batches, surfaces each new batch and its
 * challenge-window deadline, and (when you supply a validity predicate) flags
 * batches you should challenge before the window closes. Supply your own
 * `validate`, or {@link transitionRootValidator}, which applies the chain's own
 * fraud rule: an optimistic batch is fraudulent exactly when its published root
 * differs from the canonical transition root of its inputs. Wire `onInvalid` to
 * `challengeBatch` with {@link fraudProofForBatch} to close the loop.
 *
 * From chain v3.2.5 an upheld fraud rejects the batch and every later
 * unfinalized one, and the sequencer resubmits from the last good root under
 * the same indexes. The watchtower therefore tells batches apart by index AND
 * state root, so a resubmitted index is judged again.
 */
import { decodeWireBytes } from "../utils/bytes";
import {
  batchTransitionRoot,
  fraudProof,
  transitionRootVersionForBatch,
} from "../transition";
import type { RdkClient } from "../client/rdk-client";
import type { BatchView } from "../client/views";
import {
  batchChallengeWindow,
  type ChainTip,
  type ChallengeWindowStatus,
} from "../lifecycle/state-machine";

/**
 * A batch paired with its challenge window, computed with the chain's own
 * rules. Before 0.6.0 this carried a deadline built by adding seconds to a
 * block height, so every value in it was wrong; use `window`.
 */
export interface BatchDeadline {
  batch: BatchView;
  /** The batch's challenge window, exactly as the chain judges it. */
  window?: ChallengeWindowStatus;
  /**
   * Time mode only: Unix seconds when the window closes. `0` on the
   * block-count path, where the deadline is a height (`window.deadlineHeight`).
   */
  deadline: number;
  /** Time mode only: seconds remaining (negative if passed). `0` otherwise. */
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
  /** Time mode: warn within this many seconds of the deadline. Default 300. */
  deadlineWarnSecs?: number;
  /** Block-count mode: warn within this many blocks of the deadline. Default 50. */
  deadlineWarnBlocks?: number;
  /**
   * The rollup's challenge window in seconds. Defaults to the value the node
   * reports for this rollup (chain v3.2.4+), then to the global
   * `default_challenge_window` param — which is wrong for a rollup that set
   * its own, so pass this if your node predates v3.2.4.
   */
  challengeWindowSecs?: number;
  /** Called on a polling error (the loop continues). */
  onError?: (error: unknown) => void;
  /**
   * Override the chain tip, for testing. Defaults to the node's `/status`. The
   * window is judged against the chain, not the local clock.
   */
  tip?: () => ChainTip | Promise<ChainTip>;
  /** @deprecated Ignored since 0.6.0 — the window is judged against `tip`. */
  nowSecs?: () => number;
}

export interface WatchtowerHandle {
  /** Stop polling. */
  stop: () => void;
}


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
  const warnBlocks = options.deadlineWarnBlocks ?? 50;
  const readTip = options.tip ?? (() => client.getChainTip());
  // A batch is its index plus its state root: from chain v3.2.5 a rejected
  // index is reused by a different batch, which must be judged afresh.
  const keyOf = (b: BatchView): string => `${b.batchIndex}:${b.stateRoot}`;
  const seen = new Set<string>();
  // Batches already alerted as near their deadline, so each alerts once.
  const warned = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let windowSecs: number | undefined = options.challengeWindowSecs;
  // Where the next poll starts. The chain's Batches query is paged; reading
  // only its first page (as releases before 0.6.0 did) left the watchtower
  // blind to every batch from #50 on. Polling starts at the oldest batch whose
  // window is still open, so that batch keeps being re-judged — its deadline
  // only approaches later — and otherwise just past the newest batch seen.
  let nextStart = 0;
  let pollFrom = 0;

  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };

  const deadlineFor = (batch: BatchView, tip: ChainTip | undefined): BatchDeadline => {
    if (!tip || windowSecs === undefined) return { batch, deadline: 0, secondsRemaining: 0 };
    const window = batchChallengeWindow(batch, windowSecs, tip);
    return {
      batch,
      window,
      deadline: window.mode === "time" ? (window.deadlineSecs ?? 0) : 0,
      secondsRemaining: window.mode === "time" ? (window.secondsRemaining ?? 0) : 0,
    };
  };

  const nearDeadline = (info: BatchDeadline): boolean => {
    const w = info.window;
    // Only a window that is still open can be "closing"; a closed one is not
    // worth an alert, and the old code raised one for every batch.
    if (!w || !w.open) return false;
    return w.mode === "time"
      ? (w.secondsRemaining ?? Infinity) <= warnSecs
      : (w.blocksRemaining ?? Infinity) <= warnBlocks;
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (windowSecs === undefined) {
        const rollup = await client.rest.getRollup(rollupId);
        windowSecs = rollup.challengeWindowSec ?? (await client.rest.getParams()).defaultChallengeWindow ?? 0;
      }
      const batches = await client.rest.listBatches(rollupId, { startIndex: pollFrom });
      let tip: ChainTip | undefined;
      try {
        tip = await readTip();
      } catch (error) {
        if (!stopped) options.onError?.(error);
      }
      let oldestOpen: number | undefined;
      for (const batch of batches) {
        if (stopped) return;
        if (batch.batchIndex >= nextStart) nextStart = batch.batchIndex + 1;
        const info = deadlineFor(batch, tip);
        const finalized = batch.status === "finalized" || batch.finalizedAt > 0;

        if (!seen.has(keyOf(batch))) {
          seen.add(keyOf(batch));
          options.onBatch?.(batch);
          if (!finalized && batch.status !== "rejected" && options.validate) {
            const ok = await options.validate(batch);
            if (!ok && !stopped) options.onInvalid?.(info);
          }
        }

        const live = !finalized && batch.status !== "rejected";
        if (live && info.window?.open) {
          if (oldestOpen === undefined || batch.batchIndex < oldestOpen) oldestOpen = batch.batchIndex;
          if (nearDeadline(info) && !warned.has(keyOf(batch)) && !stopped) {
            warned.add(keyOf(batch));
            options.onDeadline?.(info);
          }
        }
      }
      // Without a tip no window can be judged, so keep re-reading from where
      // we are rather than skipping batches whose state is unknown.
      pollFrom = tip ? (oldestOpen ?? nextStart) : pollFrom;
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

/** The canonical transition root the chain judges `batch` by. */
async function canonicalRootFor(client: RdkClient, rollupId: string, batch: BatchView): Promise<Uint8Array> {
  const version = await transitionRootVersionForBatch(client.rest, batch);
  return batchTransitionRoot(
    {
      chainId: client.network.chainId,
      rollupId,
      prevStateRoot: decodeWireBytes(batch.prevStateRoot),
      dataHash: decodeWireBytes(batch.dataHash),
      txCount: batch.txCount,
      withdrawalsRoot: decodeWireBytes(batch.withdrawalsRoot),
    },
    version,
  );
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A `validate` predicate that applies the chain's own fraud rule to an
 * optimistic batch: valid exactly when its published state root equals the
 * canonical transition root under the binding the chain judges that batch by.
 * A batch it rejects is one a challenge built by {@link fraudProofForBatch}
 * wins.
 */
export function transitionRootValidator(
  client: RdkClient,
  rollupId: string,
): (batch: BatchView) => Promise<boolean> {
  return async (batch) =>
    sameBytes(decodeWireBytes(batch.stateRoot), await canonicalRootFor(client, rollupId, batch));
}

/**
 * The fraud proof that wins a challenge against `batch`, or `undefined` when
 * the batch publishes the canonical root (a challenge would be dismissed and
 * forfeit its bond).
 */
export async function fraudProofForBatch(
  client: RdkClient,
  rollupId: string,
  batch: BatchView,
): Promise<Uint8Array | undefined> {
  const canonical = await canonicalRootFor(client, rollupId, batch);
  if (sameBytes(decodeWireBytes(batch.stateRoot), canonical)) return undefined;
  return fraudProof(decodeWireBytes(batch.prevStateRoot), canonical);
}
