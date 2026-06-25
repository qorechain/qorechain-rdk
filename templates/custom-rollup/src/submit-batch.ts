import "dotenv/config";
import { buildDaBlob } from "@qorechain/rdk";
import { getClient, GAS_PRICE, ROLLUP_ID } from "./client.js";
import { getSigner } from "./signer.js";

async function main(): Promise<void> {
  const client = getClient();
  const params = await client.params();
  const signer = await getSigner();
  const tx = await client.connectTx(signer, { gasPrice: GAS_PRICE });

  // In a real rollup these roots come from your execution layer. Here they are
  // illustrative fixed values.
  const stateRoot = `0x${"11".repeat(32)}`;
  const prevStateRoot = `0x${"00".repeat(32)}`;

  // Assemble the native DA blob and its commitment for the batch.
  const blob = buildDaBlob({
    data: new TextEncoder().encode("example batch data"),
    maxBlobSize: params.maxDaBlobSize,
  });

  // This template defaults to optimistic settlement, whose proof system is
  // `fraud`. Optimistic batches are posted without a validity proof and only
  // disputed via a fraud proof during the challenge window. The placeholder
  // bytes below stand in for that fraud-proof material — replace it (and adjust
  // the proof system) to match the settlement you choose in `rollup.config.ts`.
  const proof = new TextEncoder().encode("PLACEHOLDER_FRAUD_PROOF");

  const res = await tx.submitBatch({
    rollupId: ROLLUP_ID,
    batchIndex: 0,
    stateRoot,
    prevStateRoot,
    txCount: 1,
    dataHash: blob.dataHash,
    proof,
  });
  console.log(`Batch submitted: ${res.transactionHash} (code ${res.code})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
