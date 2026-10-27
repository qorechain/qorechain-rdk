import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  binaryMerkleProof,
  binaryMerkleRoot,
  buildDaBlob,
  bytesToHex,
  hexToBytes,
  MAX_PENDING_OPTIMISTIC_BATCHES,
  stopRollupError,
  withdrawalLeafV1,
  withdrawalLeafV2,
  withdrawalsRootError,
  withdrawalsTree,
} from "../src/index";

// Every proof in these vectors is accepted by the chain's own
// VerifyWithdrawalMerkle, and refused at the wrong index.
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/golden.json", import.meta.url)), "utf8"),
);
const w = golden.withdrawalTree;
const items = w.withdrawals.map((x: { recipient: string; amount: number }) => ({ ...x, denom: w.denom }));

describe("withdrawals, exactly as the chain builds them", () => {
  for (const version of ["v1", "v2"] as const) {
    it(`${version}: leaves, root and every proof match the chain`, () => {
      const tree = withdrawalsTree(items, { rollupId: w.rollupId, version, chainId: w.chainId });
      expect(tree.leaves.map(bytesToHex)).toEqual(w[version].leaves);
      expect(bytesToHex(tree.root)).toBe(w[version].root);
      items.forEach((_: unknown, i: number) => {
        const p = tree.proof(i);
        expect(p.proof.map(bytesToHex)).toEqual(w[version].proofs[i]);
        expect(bytesToHex(p.withdrawalsRoot)).toBe(w[version].root);
      });
    });
  }

  it("single leaves match the chain's functions", () => {
    const input = { rollupId: w.rollupId, withdrawalIndex: 0, recipient: "qor1alice", denom: "uqor", amount: 1_500_000 };
    expect(bytesToHex(withdrawalLeafV1(input))).toBe(w.v1.leaves[0]);
    expect(bytesToHex(withdrawalLeafV2(w.chainId, input))).toBe(w.v2.leaves[0]);
    expect(() => withdrawalLeafV2("", input)).toThrow(/chain id/);
  });

  it("v1 and v2 trees differ, so a proof cannot cross bindings", () => {
    expect(w.v1.root).not.toBe(w.v2.root);
  });
});

describe("generic Merkle defaults are the chain's hash", () => {
  const leaves = golden.merkle.leavesHex.map(hexToBytes);
  it("SHAKE-256 by default", () => {
    expect(bytesToHex(binaryMerkleRoot(leaves))).toBe(golden.merkle.root);
    expect(binaryMerkleProof(leaves, 1).siblings.map(bytesToHex)).toEqual(golden.merkle.proofIndex1Siblings);
  });
});

describe("DA blob commitment", () => {
  it("is the chain's qorehash.Sum256", () => {
    const blob = buildDaBlob({ data: new TextEncoder().encode(golden.daBlob.dataUtf8) });
    expect(blob.dataHash).toBe(`0x${golden.daBlob.commitment}`);
  });
});

describe("v3.2.5 rules", () => {
  it("withdrawalsRoot is empty or 32 bytes", () => {
    expect(withdrawalsRootError(undefined)).toBeUndefined();
    expect(withdrawalsRootError("")).toBeUndefined();
    expect(withdrawalsRootError(new Uint8Array(32))).toBeUndefined();
    expect(withdrawalsRootError("ab".repeat(31))).toMatch(/31/);
  });

  it("a rollup with an unsettled latest batch cannot be stopped", () => {
    expect(stopRollupError("submitted")).toMatch(/submitted/);
    expect(stopRollupError("challenged")).toMatch(/challenged/);
    expect(stopRollupError("finalized")).toBeUndefined();
    expect(stopRollupError("rejected")).toBeUndefined();
    expect(stopRollupError(undefined)).toBeUndefined();
    expect(MAX_PENDING_OPTIMISTIC_BATCHES).toBe(4096);
  });
});
