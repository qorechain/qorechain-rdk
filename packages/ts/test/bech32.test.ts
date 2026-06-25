import { describe, it, expect } from "vitest";
import { bech32ToHex, hexToBech32, bech32Prefix, ACCOUNT_PREFIX } from "../src/index";

describe("bech32 helpers", () => {
  const hex = "0x00112233445566778899aabbccddeeff00112233";

  it("round-trips hex → bech32 → hex", () => {
    const addr = hexToBech32(hex, ACCOUNT_PREFIX);
    expect(addr.startsWith(`${ACCOUNT_PREFIX}1`)).toBe(true);
    expect(bech32ToHex(addr)).toBe(hex);
  });

  it("exposes the address prefix", () => {
    const addr = hexToBech32(hex, "qorvaloper");
    expect(bech32Prefix(addr)).toBe("qorvaloper");
  });

  it("rejects malformed hex", () => {
    expect(() => hexToBech32("0xZZ")).toThrow();
    expect(() => hexToBech32("0x123")).toThrow();
  });
});
