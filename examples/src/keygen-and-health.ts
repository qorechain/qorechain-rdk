/**
 * Generate an operator key, then read a rollup's consolidated health.
 *
 * Run: pnpm tsx src/keygen-and-health.ts
 */
import {
  createRdkClient,
  generateMnemonic,
  deriveNativeAccount,
  getRollupHealth,
} from "@qorechain/rdk";

export async function main(): Promise<void> {
  // Keygen (offline). Store the mnemonic securely — anyone with it controls the account.
  const mnemonic = generateMnemonic();
  const account = await deriveNativeAccount(mnemonic);
  console.log(`new operator address: ${account.address}`);

  // Health (needs a node + a rollup id).
  const rollupId = process.env.QORE_ROLLUP_ID;
  if (!rollupId || !process.env.QORE_REST_URL) {
    console.log("Set QORE_REST_URL and QORE_ROLLUP_ID to read rollup health.");
    return;
  }
  const client = createRdkClient({
    network: (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet",
    endpoints: { rest: process.env.QORE_REST_URL },
  });
  const health = await getRollupHealth(client, rollupId);
  console.log(JSON.stringify(health, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
