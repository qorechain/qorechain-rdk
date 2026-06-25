/**
 * Read rollup, settlement-batch, and DA-blob status through the custom `qor_`
 * JSON-RPC namespace (served at the EVM JSON-RPC endpoint).
 *
 * `client.qor` is a `QorClient` exposing the `qor_*` methods:
 *   - `getRollupStatus(rollupId)`           → qor_getRollupStatus
 *   - `getSettlementBatch(rollupId, index)` → qor_getSettlementBatch
 *   - `getDABlobStatus(rollupId, index)`    → qor_getDABlobStatus
 *
 * These return loosely-typed JSON records (the raw node responses), so this
 * example prints them directly. It needs a node's EVM/`qor_` JSON-RPC endpoint.
 *
 * Run:
 *   QORE_EVM_RPC_URL=... pnpm tsx src/read-status-jsonrpc.ts
 */
import { createRdkClient } from "@qorechain/rdk";
import type { CreateRdkClientOptions } from "@qorechain/rdk";

const ROLLUP_ID = process.env.QORE_ROLLUP_ID ?? "demo-rollup";

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

  console.log(`qor_ JSON-RPC endpoint: ${client.network.endpoints.evmRpc}`);

  const status = await client.qor.getRollupStatus(ROLLUP_ID);
  console.log(`\nrollup status for "${ROLLUP_ID}":`, status);

  const batch = await client.qor.getSettlementBatch(ROLLUP_ID, 0);
  console.log(`\nsettlement batch 0:`, batch);

  const blob = await client.qor.getDABlobStatus(ROLLUP_ID, 0);
  console.log(`\nDA blob 0 status:`, blob);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
