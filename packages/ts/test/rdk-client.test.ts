import { describe, it, expect, vi } from "vitest";
import { createRdkClient, RdkTxClient } from "../src/index";
import { mockFetch } from "./mock-fetch";

describe("RdkClient", () => {
  it("resolves the network and merges endpoint overrides", () => {
    const client = createRdkClient({ endpoints: { rest: "https://rest.example" } });
    expect(client.network.chainId).toBe("qorechain-diana");
    expect(client.network.endpoints.rest).toBe("https://rest.example");
    // Unspecified endpoints keep their defaults.
    expect(client.network.endpoints.rpc).toMatch(/^http/);
  });

  it("reads params through the configured REST endpoint", async () => {
    const { fetch, calls } = mockFetch(() => ({
      json: { params: { max_rollups: 100, min_stake_for_rollup: "10000000000" } },
    }));
    const client = createRdkClient({ endpoints: { rest: "https://rest.example" }, fetch });
    const params = await client.params();
    expect(params.maxRollups).toBe(100);
    expect(calls[0].url).toBe("https://rest.example/qorechain/rdk/v1/params");
  });

  it("suggests a profile through the qor JSON-RPC endpoint with fallback", async () => {
    const { fetch } = mockFetch(() => ({ json: { result: "gaming" } }));
    const client = createRdkClient({ endpoints: { evmRpc: "https://evm.example" }, fetch });
    const res = await client.suggestProfile("real-time game");
    expect(res.profile).toBe("gaming");
    expect(res.source).toBe("advisory");
  });

  it("selects mainnet when requested", () => {
    expect(createRdkClient({ network: "mainnet" }).network.chainId).toBe("qorechain-vladi");
  });

  it("threads the network's REST endpoint into connectTx so hybrid \"auto\" works", async () => {
    const connect = vi
      .spyOn(RdkTxClient, "connect")
      .mockResolvedValue({} as unknown as RdkTxClient);
    try {
      const client = createRdkClient({ endpoints: { rest: "https://rest.example" } });
      const signer = {} as never;

      await client.connectTx(signer);
      expect(connect.mock.calls[0][2]?.rest).toBe("https://rest.example");

      // An explicit rest from the caller wins.
      await client.connectTx(signer, { rest: "https://override.example" });
      expect(connect.mock.calls[1][2]?.rest).toBe("https://override.example");
    } finally {
      connect.mockRestore();
    }
  });
});
