import { describe, it, expect } from "vitest";
import { getRollupAdvice, createRdkClient } from "../src/index";
import { mockFetch } from "./mock-fetch";

function client(handler: Parameters<typeof mockFetch>[0]) {
  const { fetch } = mockFetch(handler);
  return createRdkClient({
    network: "testnet",
    endpoints: { rest: "http://node", evmRpc: "http://evm" },
    fetch,
  });
}

describe("QCAI Rollup Copilot", () => {
  it("aggregates advice and flags fraud + congestion", async () => {
    const c = client((call) => {
      const u = call.url;
      if (u.includes("/rollup/")) return { json: { rollup: { rollup_id: "r", status: "active" } } };
      if (u.includes("/ai/v1/fee-estimate")) return { json: { uqor: "1200" } };
      if (u.includes("/ai/v1/network/recommendations")) return { json: { note: "high congestion now" } };
      if (u.includes("/ai/v1/fraud/investigations")) return { json: { investigations: [{ id: "f1", rollup: "r" }] } };
      // JSON-RPC RL agent status
      return { json: { result: { agent: "fee-policy", epoch: 5 } } };
    });
    const advice = await getRollupAdvice(c, "r");
    expect(advice.rollupId).toBe("r");
    expect(advice.fraudInvestigations).toHaveLength(1);
    expect(advice.suggestions.some((s) => s.level === "action")).toBe(true);
    expect(advice.suggestions.some((s) => /congestion/i.test(s.message))).toBe(true);
    expect(advice.warnings).toHaveLength(0);
  });

  it("degrades gracefully when an advisory surface is down", async () => {
    const c = client((call) => {
      if (call.url.includes("/rollup/")) return { json: { rollup: { rollup_id: "r", status: "active" } } };
      if (call.url.includes("/ai/v1/")) return { ok: false, status: 503, statusText: "unavailable", json: {} };
      return { json: { result: {} } };
    });
    const advice = await getRollupAdvice(c, "r");
    expect(advice.warnings.length).toBeGreaterThan(0);
    expect(advice.suggestions.length).toBeGreaterThan(0); // never throws
  });
});
