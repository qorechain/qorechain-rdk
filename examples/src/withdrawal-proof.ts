/**
 * Withdrawal proof — build a binary Merkle root over a batch's withdrawal leaves
 * and assemble the sibling-hash proof for one leaf. No node required.
 *
 * NOTE: the leaf encoding and hash must match the network's `withdrawals_root`
 * construction for the proof to verify on-chain — see the withdrawals guide.
 *
 * Run: pnpm tsx src/withdrawal-proof.ts
 */
import {
  binaryMerkleRoot,
  assembleWithdrawalProof,
  verifyBinaryMerkleProof,
  bytesToHex,
} from "@qorechain/rdk";

export async function main(): Promise<void> {
  // Illustrative leaves — in practice these encode each withdrawal (recipient,
  // amount, index, …) exactly as the chain does.
  const leaves = [
    new Uint8Array([1, 1]),
    new Uint8Array([2, 2]),
    new Uint8Array([3, 3]),
    new Uint8Array([4, 4]),
  ];

  const root = binaryMerkleRoot(leaves);
  console.log(`withdrawals_root: 0x${bytesToHex(root)}`);

  const withdrawalIndex = 2;
  const proof = assembleWithdrawalProof(leaves, withdrawalIndex);
  console.log(`proof for leaf #${withdrawalIndex}: ${proof.proof.length} sibling hashes`);

  const ok = verifyBinaryMerkleProof(leaves[withdrawalIndex], withdrawalIndex, proof.proof, root);
  console.log(`locally verifies: ${ok}`);
  // Submit with tx.executeWithdrawal({ ..., proof: proof.proof }) — see the guide.
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
