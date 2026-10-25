import "dotenv/config";
import { batchTransitionRoot, bytesToHex, transitionRootVersionFor } from "@qorechain/rdk";
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

  // No data hash: on QoreChain's native data availability no transaction
  // stores the blob on chain, so the chain refuses a batch whose data_hash
  // claims one.

  // Optimistic settlement (proof system `fraud`) posts a batch without a
  // proof; it is disputed only by a fraud proof during the challenge window.
  // If you switch `rollup.config.ts` to zk settlement, attach the validity
  // proof here instead.

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
