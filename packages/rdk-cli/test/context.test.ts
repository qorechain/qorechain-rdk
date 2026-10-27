import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context";
import { CaptureOutput } from "../src/output";

const KEY = "11".repeat(32);

describe("qorollup signing", () => {
  // Both networks refuse a classical-only transaction; before 0.7.1 the CLI
  // signed classical-only and every transaction command was refused.
  it("refuses to connect a classical-only signer, before any network call", async () => {
    let calls = 0;
    const ctx = buildContext({
      flags: { key: KEY },
      env: {},
      out: new CaptureOutput(),
      fetch: async () => {
        calls++;
        return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
      },
    });
    await expect(ctx.connectTx()).rejects.toThrow(/No post-quantum key/);
    expect(calls).toBe(0);
  });

  it("refuses a PQC seed that is not 32 bytes", async () => {
    const ctx = buildContext({ flags: { key: KEY, "pqc-seed": "ab" }, env: {}, out: new CaptureOutput() });
    await expect(ctx.connectTx()).rejects.toThrow(/32 bytes/);
  });
});
