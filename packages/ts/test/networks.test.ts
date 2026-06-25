import { describe, it, expect } from "vitest";
import { getNetwork, listNetworks } from "../src/index";

describe("networks", () => {
  it("defaults to testnet (qorechain-diana)", () => {
    const net = getNetwork();
    expect(net.name).toBe("testnet");
    expect(net.chainId).toBe("qorechain-diana");
    expect(net.endpoints.rest).toMatch(/^http/);
  });

  it("resolves mainnet (qorechain-vladi)", () => {
    expect(getNetwork("mainnet").chainId).toBe("qorechain-vladi");
  });

  it("lists both networks", () => {
    expect(listNetworks().sort()).toEqual(["mainnet", "testnet"]);
  });

  it("returns a defensive copy of endpoints", () => {
    const a = getNetwork();
    a.endpoints.rest = "mutated";
    expect(getNetwork().endpoints.rest).not.toBe("mutated");
  });
});
