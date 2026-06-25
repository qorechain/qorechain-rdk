/**
 * Ask the network's QCAI-assisted advisory which preset profile fits a
 * use-case description.
 *
 * `client.suggestProfile(useCase)` calls the `qor_suggestRollupProfile`
 * JSON-RPC method and normalizes the answer to one of the five known profiles.
 * If the advisory service is unreachable or returns something unrecognized, it
 * falls back to a documented default (`defi`) and reports `source: "fallback"`,
 * so this example is safe to run even without a live node — it will simply show
 * the fallback.
 *
 * Run:
 *   QORE_EVM_RPC_URL=... pnpm tsx src/suggest-profile.ts
 */
import { createRdkClient } from "@qorechain/rdk";
import type { CreateRdkClientOptions } from "@qorechain/rdk";

function envEndpoints(): CreateRdkClientOptions["endpoints"] {
  const endpoints: NonNullable<CreateRdkClientOptions["endpoints"]> = {};
  if (process.env.QORE_REST_URL) endpoints.rest = process.env.QORE_REST_URL;
  if (process.env.QORE_RPC_URL) endpoints.rpc = process.env.QORE_RPC_URL;
  if (process.env.QORE_EVM_RPC_URL) endpoints.evmRpc = process.env.QORE_EVM_RPC_URL;
  return endpoints;
}

export async function main(): Promise<void> {
  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const client = createRdkClient({ network, endpoints: envEndpoints() });

  const useCase = "high-frequency DeFi DEX";
  const suggestion = await client.suggestProfile(useCase);

  console.log(`Use case:    "${useCase}"`);
  console.log(`Profile:     ${suggestion.profile}`);
  console.log(`Source:      ${suggestion.source}`); // "advisory" or "fallback"
  if (suggestion.raw !== undefined) {
    console.log(`Raw response:`, suggestion.raw);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
