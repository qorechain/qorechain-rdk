import "dotenv/config";
import { getClient, ROLLUP_ID } from "./client.js";
import { connectOperator } from "./signer.js";
import { generateProof } from "./prover.js";

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

  // ZK settlement is not usable on QoreChain yet. The chain checks a zk
  // batch's proof when the batch is submitted, against a verification key
  // registered on the rollup, and no release up to v3.2.5 has a way to
  // register one: every zk batch is refused (code 21) after its fee is paid.
  // Key registration is planned for chain v3.2.7. Stop here, before paying.
  const rollup = await client.rest.getRollup(ROLLUP_ID);
  if (rollup.hasVerificationKey !== true) {
    console.error(
      `Rollup "${ROLLUP_ID}" has no ZK verification key registered, and this chain release offers no ` +
        "way to register one, so the chain would refuse this batch after charging its fee. Nothing was sent.",
    );
    process.exit(1);
  }

  // Assemble the SNARK proof (reference prover). Note: the reference circuit
  // is a demo; the chain verifies Groth16 over BLS12-381 in gnark's encoding,
  // with public inputs (prev root, state root, data hash, withdrawals root).
  const proof = await generateProof();

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
