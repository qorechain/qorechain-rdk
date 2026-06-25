import { describe, it, expect } from "vitest";
import { createRdkClient, presets, checkPreflight } from "../src/index";
import { mockFetch } from "./mock-fetch";

const PARAMS = {
  params: {
    max_rollups: 100,
    min_stake_for_rollup: "10000000000",
    rollup_creation_burn_rate: "0.01",
  },
};

describe("checkPreflight", () => {
  it("passes when endpoints, config, signer, and balance are all good", async () => {
    const { fetch } = mockFetch((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("/by_denom")) return { json: { balance: { denom: "uqor", amount: "20000000000" } } };
      return { json: {} };
    });
    const client = createRdkClient({ endpoints: { rest: "https://r" }, fetch });
    const result = await checkPreflight(client, {
      config: presets.defi({ rollupId: "d" }).build(),
      signerAddress: "qor1me",
      expectedNetwork: "testnet",
    });
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.id === "balance")?.status).toBe("ok");
    expect(result.checks.find((c) => c.id === "config")?.status).toBe("ok");
  });

  it("fails when the balance does not cover the stake", async () => {
    const { fetch } = mockFetch((call) => {
      if (call.url.includes("/params")) return { json: PARAMS };
      if (call.url.includes("/by_denom")) return { json: { balance: { denom: "uqor", amount: "5" } } };
      return { json: {} };
    });
    const client = createRdkClient({ endpoints: { rest: "https://r" }, fetch });
    const result = await checkPreflight(client, { signerAddress: "qor1me" });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "balance")?.status).toBe("fail");
  });

  it("fails when REST is unreachable", async () => {
    const { fetch } = mockFetch(() => ({ ok: false, status: 502, statusText: "Bad Gateway", json: {} }));
    const client = createRdkClient({ endpoints: { rest: "https://r" }, fetch });
    const result = await checkPreflight(client, {});
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "rest")?.status).toBe("fail");
  });

  it("warns (not fails) when no signer is configured", async () => {
    const { fetch } = mockFetch(() => ({ json: PARAMS }));
    const client = createRdkClient({ endpoints: { rest: "https://r" }, fetch });
    const result = await checkPreflight(client, {});
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.id === "signer")?.status).toBe("warn");
  });
});
