/**
 * Assemble a native data-availability blob, inspect its commitment, and query a
 * stored blob over REST.
 *
 * On QoreChain, a settlement batch commits to its data through the batch's
 * `dataHash`; the native DA backend stores the matching blob on-chain.
 * `buildDaBlob({ data })` enforces the maximum blob size and computes the
 * SHA-256 `dataHash` you place in the batch. Pass the live `maxDaBlobSize` from
 * `client.params()` rather than relying on the documented default.
 *
 * Querying a stored blob uses `client.rest.getBlob(rollupId, blobIndex)`.
 *
 * Celestia DA is selectable but not yet active on the network; before using a
 * non-native backend for live submission, guard with `assertDaBackendAvailable`,
 * which throws a clear error for `celestia`/`both`.
 *
 * Run:
 *   QORE_REST_URL=... pnpm tsx src/native-da-blob.ts
 */
import {
  createRdkClient,
  buildDaBlob,
  assertDaBackendAvailable,
} from "@qorechain/rdk";
import type { CreateRdkClientOptions, DABackend } from "@qorechain/rdk";

const ROLLUP_ID = process.env.QORE_ROLLUP_ID ?? "demo-rollup";

function envEndpoints(): CreateRdkClientOptions["endpoints"] {
  const endpoints: NonNullable<CreateRdkClientOptions["endpoints"]> = {};
  if (process.env.QORE_REST_URL) endpoints.rest = process.env.QORE_REST_URL;
  if (process.env.QORE_RPC_URL) endpoints.rpc = process.env.QORE_RPC_URL;
  if (process.env.QORE_EVM_RPC_URL) endpoints.evmRpc = process.env.QORE_EVM_RPC_URL;
  return endpoints;
}

export async function main(): Promise<void> {
  // Build a blob from raw bytes and inspect its commitment.
  const blob = buildDaBlob({ data: new TextEncoder().encode("hello, data availability") });
  console.log("native DA blob:");
  console.log(`  size:     ${blob.size} bytes`);
  console.log(`  dataHash: ${blob.dataHash}`);

  // Confirm the backend we intend to use is actually serving. `native` is the
  // only active backend today; this throws for celestia/both.
  const backend: DABackend = "native";
  assertDaBackendAvailable(backend);
  console.log(`  backend "${backend}" is available.`);

  // Query a stored blob over REST. Requires a live node; skip if no REST URL.
  if (!process.env.QORE_REST_URL) {
    console.log("\nSet QORE_REST_URL to query a stored blob via client.rest.getBlob(...).");
    return;
  }
  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const client = createRdkClient({ network, endpoints: envEndpoints() });
  const stored = await client.rest.getBlob(ROLLUP_ID, 0);
  console.log(`\nstored blob (rollup "${ROLLUP_ID}", index 0):`, stored);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
