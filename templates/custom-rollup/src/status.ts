import "dotenv/config";
import { getRollupHealth } from "@qorechain/rdk";
import { getClient, ROLLUP_ID } from "./client.js";

async function main(): Promise<void> {
  const client = getClient();
  const health = await getRollupHealth(client, ROLLUP_ID);
  console.log(JSON.stringify(health, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
