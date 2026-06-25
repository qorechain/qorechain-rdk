import "dotenv/config";
import { getClient, GAS_PRICE, ROLLUP_ID } from "./client.js";
import { getSigner } from "./signer.js";

/**
 * Optimistic challenge flow.
 *
 * The NFT profile settles optimistically: a submitted batch is presumed valid
 * and finalizes after its challenge window elapses, unless a challenger disputes
 * it with a fraud proof. This script demonstrates raising that challenge.
 *
 * A challenger posts a bond and a fraud proof against a specific batch index.
 * The chain then opens a challenge, which a resolver settles with
 * `tx.resolveChallenge({ rollupId, batchIndex, fraudUpheld })`:
 *   - `fraudUpheld: true`  → the batch is rejected and the bond is awarded.
 *   - `fraudUpheld: false` → the challenge is dismissed and the batch proceeds.
 */
async function main(): Promise<void> {
  const client = getClient();
  const signer = await getSigner();
  const tx = await client.connectTx(signer, { gasPrice: GAS_PRICE });

  // PLACEHOLDER fraud proof. In a real challenge this is the encoded proof that
  // the disputed batch's state transition is invalid; the exact encoding is
  // defined by the network's fraud-proof verifier. Replace before live use.
  const fraudProof = "0x00";

  const res = await tx.challengeBatch({
    rollupId: ROLLUP_ID,
    batchIndex: 0,
    proof: fraudProof,
  });
  console.log(`Challenge submitted: ${res.transactionHash} (code ${res.code})`);

  // A resolver then closes the challenge, e.g.:
  //   await tx.resolveChallenge({ rollupId: ROLLUP_ID, batchIndex: 0, fraudUpheld: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
