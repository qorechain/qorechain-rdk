import { describe, it, expect } from "vitest";
import { createRdkClient, getRollupHealth, eventsFromTxHash, watchRollup } from "../src/index";
import { mockFetch } from "./mock-fetch";

const PARAMS = { params: { default_challenge_window: 604800 } };

function clientFor(handler: Parameters<typeof mockFetch>[0]) {
  const { fetch, calls } = mockFetch(handler);
  return { client: createRdkClient({ endpoints: { rest: "https://r" }, fetch }), calls };
}

describe("getRollupHealth", () => {
  it("reports an active rollup with a submitted batch and challenge countdown", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("?latest=true"))
        return { json: { batch: { batch_index: 3, status: "submitted", submitted_at: 1000 } } };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { nowSecs: 1100 });
    expect(health.status).toBe("active");
    expect(health.healthy).toBe(true);
    expect(health.latestBatchIndex).toBe(3);
    expect(health.batchAgeSecs).toBe(100);
    expect(health.challengeDeadlineSecs).toBe(1000 + 604800);
    expect(health.secondsUntilChallengeDeadline).toBe(604700);
  });

  it("is unhealthy when the latest batch was rejected", async () => {
    const { client } = clientFor((call) => {
      if (call.url.includes("?latest=true"))
        return { json: { batch: { batch_index: 1, status: "rejected", submitted_at: 1000 } } };
      if (call.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const health = await getRollupHealth(client, "d", { nowSecs: 2000 });
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
      if (call.url.includes("?latest=true")) return { ok: false, status: 404, statusText: "x", json: {} };
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
