/**
 * Connect to a QoreChain node and read the live `rdk` module parameters.
 *
 * This is the "hello world" of the RDK: it builds an `RdkClient` from the
 * `QORE_*` environment variables (network preset plus optional endpoint
 * overrides), then reads the authoritative module parameters from the chain via
 * the REST surface. Always prefer these live values over the documented
 * defaults when sizing stakes, blobs, or challenge windows.
 *
 * Run:
 *   QORE_NETWORK=testnet QORE_REST_URL=... pnpm tsx src/connect-and-read-params.ts
 */
import { createRdkClient } from "@qorechain/rdk";
import type { CreateRdkClientOptions } from "@qorechain/rdk";

/** Build endpoint overrides from the environment (only the ones that are set). */
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

  console.log(`Network: ${client.network.name} (chain id: ${client.network.chainId})`);
  console.log(`REST endpoint: ${client.network.endpoints.rest}`);

  const params = await client.params();
  console.log("rdk module params:");
  console.log(`  maxRollups:             ${params.maxRollups}`);
  console.log(`  minStakeForRollup:      ${params.minStakeForRollup} uqor`);
  console.log(`  rollupCreationBurnRate: ${params.rollupCreationBurnRate}`);
  console.log(`  defaultChallengeWindow: ${params.defaultChallengeWindow} s`);
  console.log(`  maxDaBlobSize:          ${params.maxDaBlobSize} bytes`);
  console.log(`  blobRetentionBlocks:    ${params.blobRetentionBlocks}`);
  console.log(`  maxBatchesPerBlock:     ${params.maxBatchesPerBlock}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
