import "dotenv/config";
import {
  assertDaBackendAvailable,
  batchTransitionRoot,
  bytesToHex,
  isDaBackendAvailable,
  transitionRootVersionFor,
} from "@qorechain/rdk";
import { getClient, ROLLUP_ID } from "./client.js";
import { connectOperator } from "./signer.js";

async function main(): Promise<void> {
  const client = getClient();
  // Signs hybrid: both networks refuse a classical-only native-lane transaction.
  const tx = await connectOperator(client);

  // An optimistic batch must publish the chain's canonical transition root
  // for its inputs. Any other root is provably fraudulent: a challenger who
  // names the canonical root wins, and from chain v3.2.5 any account can
  // resolve that challenge and be paid from this rollup's escrow. Compute it
  // right before submitting: the chain switches binding at its v3.2.5 height.
  const prevStateRoot = `0x${"00".repeat(32)}`; // the last settled root (zero for batch 0)
  const txCount = 1;
  const version = await transitionRootVersionFor(client.rest);
  const stateRoot = batchTransitionRoot(
    { chainId: client.network.chainId, rollupId: ROLLUP_ID, prevStateRoot, txCount },
    version,
  );

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
  // claims one.

  // Optimistic settlement carries a `fraud` proof system: the batch is posted
  // optimistically and only disputed via a fraud proof during the challenge
  // window (see `src/challenge.ts`). The submission itself does not include a
  // validity proof.
  const res = await tx.submitBatch({
    rollupId: ROLLUP_ID,
    batchIndex: 0,
    stateRoot,
    prevStateRoot,
    txCount,
  });
  console.log(`State root ${version}: ${bytesToHex(stateRoot)}`);
  console.log(`Batch submitted: ${res.transactionHash} (code ${res.code})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
