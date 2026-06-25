import { describe, it, expect } from "vitest";
import {
  binaryMerkleRoot,
  binaryMerkleProof,
  verifyBinaryMerkleProof,
  assembleWithdrawalProof,
} from "../src/index";

function leaf(n: number): Uint8Array {
  return new Uint8Array([n]);
}

describe("binary Merkle", () => {
  it("a single leaf's root is the hashed leaf, with an empty proof", () => {
    const leaves = [leaf(1)];
    const { siblings, root } = binaryMerkleProof(leaves, 0);
    expect(siblings).toHaveLength(0);
    expect(root).toEqual(binaryMerkleRoot(leaves));
  });

  it("proof verifies for every leaf (power-of-two set)", () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    const root = binaryMerkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const { siblings } = binaryMerkleProof(leaves, i);
      expect(siblings).toHaveLength(2);
      expect(verifyBinaryMerkleProof(leaves[i], i, siblings, root)).toBe(true);
    }
  });

  it("handles an odd number of leaves (duplicate-last)", () => {
    const leaves = [leaf(1), leaf(2), leaf(3)];
    const root = binaryMerkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const { siblings } = binaryMerkleProof(leaves, i);
      expect(verifyBinaryMerkleProof(leaves[i], i, siblings, root)).toBe(true);
    }
  });

  it("rejects a tampered leaf", () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    const root = binaryMerkleRoot(leaves);
    const { siblings } = binaryMerkleProof(leaves, 2);
    expect(verifyBinaryMerkleProof(leaf(99), 2, siblings, root)).toBe(false);
  });

  it("rejects an out-of-range index", () => {
    expect(() => binaryMerkleProof([leaf(1)], 5)).toThrow(/out of range/);
  });

  it("assembleWithdrawalProof returns siblings + root for the index", () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    const w = assembleWithdrawalProof(leaves, 1);
    expect(w.withdrawalIndex).toBe(1);
    expect(verifyBinaryMerkleProof(leaves[1], 1, w.proof, w.withdrawalsRoot)).toBe(true);
  });
});
