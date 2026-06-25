import { describe, it, expect } from "vitest";
import { QorClient } from "../src/index";
import { mockFetch } from "./mock-fetch";

describe("QorClient", () => {
  it("sends a JSON-RPC 2.0 request and returns the result", async () => {
    const { fetch, calls } = mockFetch(() => ({
      json: { jsonrpc: "2.0", id: 1, result: { status: "active" } },
    }));
    const qor = new QorClient("http://node.example:8545", { fetch });
    const result = await qor.getRollupStatus("r");
    expect(result).toEqual({ status: "active" });

    const body = JSON.parse(calls[0].init!.body!);
    expect(body.method).toBe("qor_getRollupStatus");
    expect(body.params).toEqual(["r"]);
    expect(body.jsonrpc).toBe("2.0");
  });

  it("passes batch index as a number", async () => {
    const { fetch, calls } = mockFetch(() => ({ json: { result: {} } }));
    const qor = new QorClient("http://node.example", { fetch });
    await qor.getSettlementBatch("r", 7n);
    expect(JSON.parse(calls[0].init!.body!).params).toEqual(["r", 7]);
  });

  it("throws on a JSON-RPC error", async () => {
    const { fetch } = mockFetch(() => ({
      json: { error: { code: -32000, message: "boom" } },
    }));
    const qor = new QorClient("http://node.example", { fetch });
    await expect(qor.suggestRollupProfile("x")).rejects.toThrow(/boom/);
  });
});
