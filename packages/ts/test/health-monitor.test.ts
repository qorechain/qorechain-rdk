import { describe, it, expect } from "vitest";
import { createRdkClient, getRollupHealth, eventsFromTxHash, watchRollup } from "../src/index";
import { mockFetch } from "./mock-fetch";

const PARAMS = { params: { default_challenge_window: 604800 } };

function clientFor(handler: Parameters<typeof mockFetch>[0]) {
  const { fetch, calls } = mockFetch(handler);
  return { client: createRdkClient({ endpoints: { rest: "https://r" }, fetch }), calls };
}

describe("getRollupHealth", () => {
  // `submitted_at` is a BLOCK HEIGHT on chain. These tests used to feed it as a
  // Unix timestamp and assert the arithmetic that followed — encoding the bug.

  it("applies the block-count window to a batch with no submission time", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("/latest_batch/"))
        return { json: { batch: { batch_index: 3, status: "submitted", submitted_at: 1000 } } };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { tip: { height: 1100, timeSecs: 5_000_000 } });
    expect(health.status).toBe("active");
    expect(health.healthy).toBe(true);
    expect(health.latestBatchIndex).toBe(3);
    expect(health.latestBatchHeight).toBe(1000);
    expect(health.batchAgeBlocks).toBe(100);
    // No submission time recorded, so the age in seconds is genuinely unknown.
    expect(health.batchAgeSecs).toBeUndefined();
    const w = health.challengeWindow!;
    expect(w.mode).toBe("blocks");
    expect(w.windowBlocks).toBe(604800 / 6); // the chain's own 6 s assumption
    expect(w.deadlineHeight).toBe(1000 + 100800);
    expect(w.blocksRemaining).toBe(1000 + 100800 - 1100);
    expect(w.open).toBe(true);
    expect(w.finalizable).toBe(false);
  });

  it("applies the time window when the node records the submission time", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("/latest_batch/"))
        return {
          json: { batch: { batch_index: 4, status: "submitted", submitted_at: 2000, submitted_time: 1_700_000_000 } },
        };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", {
      tip: { height: 2100, timeSecs: 1_700_000_000 + 100 },
    });
    expect(health.batchAgeSecs).toBe(100);
    const w = health.challengeWindow!;
    expect(w.mode).toBe("time");
    expect(health.challengeDeadlineSecs).toBe(1_700_000_000 + 604800);
    expect(health.secondsUntilChallengeDeadline).toBe(604800 - 100);
    expect(w.open).toBe(true);
  });

  it("uses the rollup's own window over the global default", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("/latest_batch/"))
        return { json: { batch: { batch_index: 1, status: "submitted", submitted_at: 1000 } } };
      if (call.url.includes("/rollup/"))
        return { json: { rollup: { status: "active", challenge_window_sec: 3600 } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { tip: { height: 1000, timeSecs: 0 } });
    expect(health.challengeWindow?.windowBlocks).toBe(600);
    expect(health.notes.some((n) => n.includes("global default"))).toBe(false);
  });

  it("says so when it had to fall back to the global window", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("/latest_batch/"))
        return { json: { batch: { batch_index: 1, status: "submitted", submitted_at: 1000 } } };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { tip: { height: 1000, timeSecs: 0 } });
    expect(health.notes.some((n) => n.includes("global default"))).toBe(true);
  });

  it("reads the latest batch from the chain's LatestBatch route", async () => {
    const { client, calls } = clientFor((call) => {
      if (call.url.includes("/latest_batch/"))
        return { json: { batch: { batch_index: 1, status: "finalized", submitted_at: 10 } } };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { tip: { height: 20, timeSecs: 0 } });
    // Before 0.6.0 this hit `/batches/{id}?latest=true`, got the list back, read
    // it as one empty batch, and reported "no batches yet" for every rollup.
    expect(health.hasBatches).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/qorechain/rdk/v1/latest_batch/d"))).toBe(true);
  });

  it("is unhealthy when the latest batch was rejected", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/latest_batch/"))
        return { json: { batch: { batch_index: 1, status: "rejected", submitted_at: 1000 } } };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { tip: { height: 2000, timeSecs: 0 } });
    expect(health.healthy).toBe(false);
    expect(health.notes.some((n) => n.includes("rejected"))).toBe(true);
  });
});

describe("eventsFromTxHash", () => {
  it("decodes rdk events from a tx response", async () => {
    const { client } = clientFor(() => ({
      json: {
        tx_response: {
          events: [
            { type: "tx", attributes: [{ key: "acc_seq", value: "x" }] },
            { type: "rollup_created", attributes: [{ key: "rollup_id", value: "d" }] },
          ],
        },
      },
    }));
    const events = await eventsFromTxHash(client, "ABC123");
    expect(events.map((e) => e.type)).toEqual(["rollup_created"]);
    expect(events[0].attributes.rollup_id).toBe("d");
  });
});

describe("watchRollup", () => {
  it("invokes onUpdate at least once, then stops", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/latest_batch/")) return { ok: false, status: 404, statusText: "x", json: {} };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const update = await new Promise<string>((resolve) => {
      const watcher = watchRollup(client, "d", {
        intervalMs: 10_000,
        onUpdate: (h) => {
          watcher.stop();
          resolve(h.status);
        },
      });
    });
    expect(update).toBe("active");
  });
});
