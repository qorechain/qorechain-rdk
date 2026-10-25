import "dotenv/config";
import {
  assertDaBackendAvailable,
  isDaBackendAvailable,
} from "@qorechain/rdk";
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

  // The NFT profile selects Celestia DA, which is PLANNED — selectable but not
  // yet active on the network. Until it ships, post data with the `native`
  // backend. The guard below shows how to check availability before submitting;
  // `assertDaBackendAvailable("celestia")` would throw the "planned / not yet
  // available" error today.
  if (!isDaBackendAvailable("celestia")) {
    console.warn(
      "note: Celestia DA is planned but not yet active — using native DA for now.",
    );
  }
  assertDaBackendAvailable("native"); // native is active; passes.

  // No data hash: on QoreChain's native data availability no transaction
  // stores the blob on chain, so the chain refuses a batch whose data_hash
  // claims one. The state roots and proof bind the batch.

  // Optimistic settlement carries a `fraud` proof system: the batch is posted
  // optimistically and only disputed via a fraud proof during the challenge
  // window (see `src/challenge.ts`). The submission itself does not include a
  // validity proof.
  const res = await tx.submitBatch({
    rollupId: ROLLUP_ID,
    batchIndex: 0,
    stateRoot,
    prevStateRoot,
    txCount: 1,
  });
  console.log(`Batch submitted: ${res.transactionHash} (code ${res.code})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
