/**
 * Live monitoring helpers built on the read surface: poll a rollup's health on
 * an interval, and decode the `rdk` events emitted by a transaction.
 */
import type { RdkClient } from "../client/rdk-client";
import { getRollupHealth, type RollupHealth } from "../health";
import { decodeRdkEvents, type DecodedRdkEvent, type RawEvent } from "../events/decode";
import type { RawRecord } from "../client/views";

export interface WatchOptions {
  /** Poll interval in milliseconds. Default 5000. */
  intervalMs?: number;
  /** Abort the watch when this signal fires. */
  signal?: AbortSignal;
  /** Called with each health snapshot. */
  onUpdate: (health: RollupHealth) => void;
  /** Called on a polling error (the loop continues). */
  onError?: (error: unknown) => void;
  /** Override the clock (seconds), for testing. */
  nowSecs?: () => number;
}

export interface Watcher {
  /** Stop polling. */
  stop: () => void;
}

/**
 * Poll a rollup's {@link RollupHealth} on an interval, invoking `onUpdate` each
 * time. Returns a handle with `stop()`; also stops on the optional AbortSignal.
 */
export function watchRollup(client: RdkClient, rollupId: string, options: WatchOptions): Watcher {
  const intervalMs = options.intervalMs ?? 5000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const health = await getRollupHealth(
        client,
        rollupId,
        options.nowSecs ? { nowSecs: options.nowSecs() } : {},
      );
      if (!stopped) options.onUpdate(health);
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

/** Decode the `rdk` events emitted by a transaction, by hash. */
export async function eventsFromTxHash(
  client: RdkClient,
  hash: string,
): Promise<DecodedRdkEvent[]> {
  const body = await client.rest.getTx(hash);
  const txResponse = (body.tx_response ?? body.txResponse ?? {}) as RawRecord;
  const events = Array.isArray(txResponse.events) ? (txResponse.events as RawEvent[]) : [];
  return decodeRdkEvents(events);
}
