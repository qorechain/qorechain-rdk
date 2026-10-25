import "dotenv/config";
import {
  batchTransitionRoot,
  bytesToHex,
  decodeWireBytes,
  fraudProof,
  transitionRootVersionForBatch,
} from "@qorechain/rdk";
import { getClient, ROLLUP_ID } from "./client.js";
import { connectOperator } from "./signer.js";

/**
 * Optimistic challenge flow.
 *
 * The NFT profile settles optimistically: a submitted batch is presumed valid
 * and finalizes after its challenge window elapses, unless a challenger proves
 * it wrong. The chain's verifier upholds a challenge exactly when the batch's
 * published state root differs from the canonical transition root of its
 * inputs, and the challenger's proof names that canonical root. So this script
 * reads the batch from chain, recomputes the root under the binding the chain
 * judges that batch by, and challenges only a batch that is provably wrong: a
 * challenge against an honest batch is dismissed and its bond is forfeited.
 *
 * Once a challenge is open, any account can settle it (chain v3.2.5) with
 * `tx.resolveChallenge({ rollupId, batchIndex, fraudUpheld })`; the chain checks
 * the stored proof itself and refuses an assertion that does not match.
 */
async function main(): Promise<void> {
  const client = getClient();
  const batchIndex = Number(process.env.QORE_BATCH_INDEX ?? "0");
  const batch = await client.rest.getBatch(ROLLUP_ID, batchIndex);

  const version = await transitionRootVersionForBatch(client.rest, batch);
  const canonical = batchTransitionRoot(
    {
      chainId: client.network.chainId,
      rollupId: ROLLUP_ID,
      prevStateRoot: decodeWireBytes(batch.prevStateRoot),
      dataHash: decodeWireBytes(batch.dataHash),
      txCount: batch.txCount,
      withdrawalsRoot: decodeWireBytes(batch.withdrawalsRoot),
    },
    version,
  );
  const published = bytesToHex(decodeWireBytes(batch.stateRoot));
  if (published === bytesToHex(canonical)) {
    console.log(
      `Batch ${batchIndex} is honest (${version} root ${published}); a challenge would be ` +
        "dismissed and forfeit the bond, so none was sent.",
    );
    return;
  }

  // Signs hybrid: both networks refuse a classical-only native-lane transaction.
  const tx = await connectOperator(client);
  const res = await tx.challengeBatch({
    rollupId: ROLLUP_ID,
    batchIndex,
    proof: fraudProof(decodeWireBytes(batch.prevStateRoot), canonical),
  });
  console.log(
    `Batch ${batchIndex} published ${published}, the ${version} root is ${bytesToHex(canonical)}: ` +
      `challenge submitted ${res.transactionHash} (code ${res.code})`,
  );
  // Then, from any account:
  //   await tx.resolveChallenge({ rollupId: ROLLUP_ID, batchIndex, fraudUpheld: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
