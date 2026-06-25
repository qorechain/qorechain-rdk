import "dotenv/config";
import { getClient, ROLLUP_ID } from "./client.js";

async function main(): Promise<void> {
  const client = getClient();

  const rollup = await client.rest.getRollup(ROLLUP_ID);
  console.log("Rollup:");
  console.log(`  status:     ${rollup.status}`);
  console.log(`  profile:    ${rollup.profile}`);
  console.log(`  settlement: ${rollup.settlementMode}`);
  console.log(`  DA backend: ${rollup.daBackend}`);
  console.log(`  VM:         ${rollup.vmType}`);

  try {
    const batch = await client.rest.getLatestBatch(ROLLUP_ID);
    console.log("Latest batch:");
    console.log(`  index:   ${batch.batchIndex}`);
    console.log(`  status:  ${batch.status}`);
    console.log(`  txCount: ${batch.txCount}`);
  } catch {
    console.log("No settlement batches submitted yet.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
