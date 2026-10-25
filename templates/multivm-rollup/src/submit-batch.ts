import "dotenv/config";
import { getClient, ROLLUP_ID } from "./client.js";
import { connectOperator } from "./signer.js";

async function main(): Promise<void> {
  const client = getClient();
  // Signs hybrid: both networks refuse a classical-only native-lane transaction.
  const tx = await connectOperator(client);

  // In a real rollup these roots come from your execution layer. Here they are
  // illustrative fixed values.
  const stateRoot = `0x${"11".repeat(32)}`;
  const prevStateRoot = `0x${"00".repeat(32)}`;

  // No data hash: on QoreChain's native data availability no transaction
  // stores the blob on chain, so the chain refuses a batch whose data_hash
  // claims one. The state roots and proof bind the batch.

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
    proof,
  });
  console.log(`Batch submitted: ${res.transactionHash} (code ${res.code})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
