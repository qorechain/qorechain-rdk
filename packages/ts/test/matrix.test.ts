import { describe, it, expect } from "vitest";
import {
  isProofCompatible,
  requiresBasedSequencer,
  validProofSystems,
  SETTLEMENT_PARADIGMS,
  PROOF_SYSTEMS,
} from "../src/index";

describe("settlement → proof compatibility matrix", () => {
  it("maps each settlement to exactly its allowed proofs", () => {
    expect(validProofSystems("optimistic")).toEqual(["fraud"]);
    expect(validProofSystems("zk")).toEqual(["snark", "stark"]);
    expect(validProofSystems("based")).toEqual(["none"]);
    expect(validProofSystems("sovereign")).toEqual(["none"]);
  });

  it("accepts only compatible pairs and rejects the rest", () => {
    const allowed = new Set([
      "optimistic:fraud",
      "zk:snark",
      "zk:stark",
      "based:none",
      "sovereign:none",
    ]);
    for (const s of SETTLEMENT_PARADIGMS) {
      for (const p of PROOF_SYSTEMS) {
        expect(isProofCompatible(s, p)).toBe(allowed.has(`${s}:${p}`));
      }
    }
  });

  it("flags only based settlement as requiring the based sequencer", () => {
    expect(requiresBasedSequencer("based")).toBe(true);
    expect(requiresBasedSequencer("optimistic")).toBe(false);
    expect(requiresBasedSequencer("zk")).toBe(false);
    expect(requiresBasedSequencer("sovereign")).toBe(false);
  });
});
