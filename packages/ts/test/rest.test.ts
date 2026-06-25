import { describe, it, expect } from "vitest";
import { RestClient } from "../src/index";
import { mockFetch } from "./mock-fetch";

describe("RestClient", () => {
  it("maps the params response from snake_case", async () => {
    const { fetch, calls } = mockFetch(() => ({
      json: {
        params: {
          max_rollups: 100,
          min_stake_for_rollup: "10000000000",
          rollup_creation_burn_rate: "0.01",
          default_challenge_window: 604800,
          max_da_blob_size: 2097152,
          blob_retention_blocks: 432000,
          max_batches_per_block: 10,
        },
      },
    }));
    const rest = new RestClient("http://node.example/", { fetch });
    const params = await rest.getParams();
    expect(params.maxRollups).toBe(100);
    expect(params.minStakeForRollup).toBe("10000000000");
    expect(params.rollupCreationBurnRate).toBe("0.01");
    expect(params.maxDaBlobSize).toBe(2097152);
    expect(calls[0].url).toBe("http://node.example/qorechain/rdk/v1/params");
  });

  it("builds the rollup and batch routes correctly", async () => {
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.includes("/rollup/")) return { json: { rollup: { rollup_id: "r", status: "active" } } };
      return { json: { batch: { rollup_id: "r", batch_index: 5, status: "finalized" } } };
    });
    const rest = new RestClient("http://node.example", { fetch });

    const rollup = await rest.getRollup("my rollup");
    expect(rollup.rollupId).toBe("r");
    expect(rollup.status).toBe("active");
    expect(calls[0].url).toBe("http://node.example/qorechain/rdk/v1/rollup/my%20rollup");

    const batch = await rest.getBatch("r", 5);
    expect(batch.batchIndex).toBe(5);
    expect(calls[1].url).toBe("http://node.example/qorechain/rdk/v1/batch/r/5");

    await rest.getLatestBatch("r");
    expect(calls[2].url).toBe("http://node.example/qorechain/rdk/v1/batches/r?latest=true");
  });

  it("maps a rollups list", async () => {
    const { fetch } = mockFetch(() => ({
      json: { rollups: [{ rollup_id: "a" }, { rollup_id: "b" }] },
    }));
    const rest = new RestClient("http://node.example", { fetch });
    const rollups = await rest.listRollups();
    expect(rollups.map((r) => r.rollupId)).toEqual(["a", "b"]);
  });

  it("throws on a non-ok response", async () => {
    const { fetch } = mockFetch(() => ({ ok: false, status: 404, statusText: "Not Found", json: {} }));
    const rest = new RestClient("http://node.example", { fetch });
    await expect(rest.getParams()).rejects.toThrow(/404/);
  });
});
