import { describe, it, expect } from "vitest";
import { requestFaucet } from "../src/index";
import { mockFetch } from "./mock-fetch";

describe("requestFaucet", () => {
  it("throws a clear error when no URL is configured", async () => {
    await expect(requestFaucet({ address: "qor1me" })).rejects.toThrow(/No faucet URL/);
  });

  it("posts the address + denom to the configured URL", async () => {
    const { fetch, calls } = mockFetch(() => ({ json: { ok: true } }));
    const res = await requestFaucet({ url: "https://faucet.example", address: "qor1me", fetch });
    expect(res.ok).toBe(true);
    const body = JSON.parse(calls[0].init!.body!);
    expect(body).toEqual({ address: "qor1me", denom: "uqor" });
    expect(calls[0].init!.method).toBe("POST");
  });

  it("throws on a non-ok faucet response", async () => {
    const { fetch } = mockFetch(() => ({ ok: false, status: 429, statusText: "Too Many", json: {} }));
    await expect(
      requestFaucet({ url: "https://faucet.example", address: "qor1me", fetch }),
    ).rejects.toThrow(/429/);
  });
});
