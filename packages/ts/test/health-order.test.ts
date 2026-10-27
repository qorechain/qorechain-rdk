import { describe, expect, it } from "vitest";
import { createRdkClient, getRollupHealth } from "../src/index";
import { mockFetch } from "./mock-fetch";

// From chain v3.2.5 batches finalize in order: batch 1's window has passed,
// but batch 0 is challenged, so batch 1 is held back.
function node(featureOn: boolean) {
  const batches = [
    { batch_index: 0, status: "challenged", submitted_at: 100, submitted_time: 1000 },
    { batch_index: 1, status: "submitted", submitted_at: 101, submitted_time: 1001 },
  ];
  return mockFetch((call) => {
    const u = new URL(call.url);
    if (u.pathname.includes("/rollup/"))
      return { json: { rollup: { status: "active", challenge_window_sec: 3600 } } };
    if (u.pathname.includes("/latest_batch/")) return { json: { batch: batches[1] } };
    if (u.pathname.includes("/batches/")) return { json: { batches, next_index: 0 } };
    if (u.pathname.includes("protocol_features"))
      return { json: { features: [{ name: "rdk-challenge-settlement", enabled: featureOn }] } };
    return { json: {} };
  }).fetch;
}

describe("health under in-order finality", () => {
  const tip = { height: 5000, timeSecs: 1001 + 3600 };
  it("reports the earlier batch holding the latest one back", async () => {
    const client = createRdkClient({ endpoints: { rest: "https://r", rpc: "https://rpc" }, fetch: node(true) });
    const h = await getRollupHealth(client, "roll-x", { tip });
    expect(h.challengeWindow?.finalizable).toBe(true);
    expect(h.heldBackBy).toEqual({ batchIndex: 0, status: "challenged" });
    expect(h.notes.join(" ")).toMatch(/finalize in order and batch 0 is still challenged/);
  });

  it("does not before the chain switches to in-order settlement", async () => {
    const client = createRdkClient({ endpoints: { rest: "https://r", rpc: "https://rpc" }, fetch: node(false) });
    const h = await getRollupHealth(client, "roll-x", { tip });
    expect(h.heldBackBy).toBeUndefined();
  });
});
