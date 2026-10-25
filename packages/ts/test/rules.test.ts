import { describe, it, expect } from "vitest";
import {
  dataHashError,
  isValidRollupId,
  rollupIdError,
  withdrawalErrors,
  MAX_WITHDRAWAL_PROOF_DEPTH,
  ROLLUP_ESCROW_DENOM,
} from "../src/index";

// Both vector sets are ported verbatim from the chain's own tests
// (x/rdk/types/rollup_id_test.go and msgs_withdrawal_test.go at v3.2.3), so a
// disagreement here is a disagreement with the chain, not with a guess.

describe("rollup id grammar (chain v3.2.2+)", () => {
  const good = [
    "abc", "a1b", "0rollup", "my-rollup", "my_rollup", "my.rollup", "r--",
    "victim", "a".repeat(64), "9.9.9",
  ];
  const bad = [
    "", "ab", "a".repeat(65),
    "victim/x", "Victim", "ROLL", "-abc", ".abc", "_abc",
    "has space", "tab\tid", "nul\u0000id", "new\nline", "é-rollup", "rollup✓",
    "a/b", "a\\b", "a:b", "a+b", "a%2fb",
  ];

  it.each(good)("accepts %j", (id) => {
    expect(rollupIdError(id)).toBeUndefined();
    expect(isValidRollupId(id)).toBe(true);
  });

  it.each(bad)("refuses %j", (id) => {
    expect(rollupIdError(id)).toBeDefined();
    expect(isValidRollupId(id)).toBe(false);
  });

  it("measures length in bytes, as the chain does", () => {
    // 63 ASCII bytes + a 2-byte character = 65 bytes: over the limit even though
    // it is only 64 characters.
    expect(rollupIdError("a".repeat(63) + "é")).toMatch(/3 to 64/);
  });
});

describe("withdrawal pre-checks (chain v3.2.3+)", () => {
  const sib = "ab".repeat(32); // 32 bytes
  const good = () => ({
    submitter: "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h",
    rollupId: "roll-1",
    recipient: "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h",
    denom: ROLLUP_ESCROW_DENOM,
    amount: 1,
    proof: [sib, sib],
  });

  it("accepts a well-formed withdrawal", () => {
    expect(withdrawalErrors(good())).toEqual([]);
  });

  const cases: Record<string, (w: ReturnType<typeof good>) => void> = {
    "bad submitter": (w) => (w.submitter = "nope"),
    "empty rollup": (w) => (w.rollupId = ""),
    "bad recipient": (w) => (w.recipient = "nope"),
    "other denom": (w) => (w.denom = "uatom"),
    "zero amount": (w) => (w.amount = 0),
    "negative": (w) => (w.amount = -5),
    "short sibling": (w) => (w.proof = ["010203"]),
    "too deep proof": (w) => (w.proof = Array(MAX_WITHDRAWAL_PROOF_DEPTH + 1).fill(sib)),
  };

  it.each(Object.entries(cases))("refuses %s", (_name, mutate) => {
    const w = good();
    mutate(w);
    expect(withdrawalErrors(w).length).toBeGreaterThan(0);
  });

  it("accepts exactly the maximum depth", () => {
    expect(withdrawalErrors({ ...good(), proof: Array(MAX_WITHDRAWAL_PROOF_DEPTH).fill(sib) })).toEqual([]);
  });

  it("does not hold an old id to the new grammar", () => {
    // Ids created before v3.2.2 may sit outside it and stay valid; the chain
    // checks only emptiness for a withdrawal.
    expect(withdrawalErrors({ ...good(), rollupId: "Legacy/ID" })).toEqual([]);
  });
});

describe("dataHashError", () => {
  it("refuses a data hash on native and both DA, where no blob can be stored", () => {
    expect(dataHashError("native", "bb")).toMatch(/must be empty/);
    expect(dataHashError("both", new Uint8Array([1]))).toMatch(/must be empty/);
  });

  it("accepts an empty data hash in any spelling", () => {
    for (const empty of [undefined, "", "0x", new Uint8Array()]) {
      expect(dataHashError("native", empty)).toBeUndefined();
    }
  });

  it("leaves other backends to the chain", () => {
    expect(dataHashError("celestia", "bb")).toBeUndefined();
  });
});
