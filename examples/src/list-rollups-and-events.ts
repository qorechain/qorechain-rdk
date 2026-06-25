/**
 * List registered rollups over REST, and decode `rdk` lifecycle events from a
 * transaction's event list.
 *
 * `client.rest.listRollups()` returns the typed configuration/status view of
 * every registered rollup. Separately, when you broadcast a transaction the
 * result carries Cosmos events; `decodeRdkEvents([...])` filters those down to
 * the `rdk` module's typed events and exposes each one's attributes as a plain
 * map, while `findRdkEvent(events, type)` returns the first event of a given
 * type. The sample event array below is the shape `@cosmjs` tx results expose,
 * so this part runs without a node.
 *
 * Run:
 *   QORE_REST_URL=... pnpm tsx src/list-rollups-and-events.ts
 */
import {
  createRdkClient,
  decodeRdkEvents,
  findRdkEvent,
} from "@qorechain/rdk";
import type { CreateRdkClientOptions, RawEvent } from "@qorechain/rdk";

function envEndpoints(): CreateRdkClientOptions["endpoints"] {
  const endpoints: NonNullable<CreateRdkClientOptions["endpoints"]> = {};
  if (process.env.QORE_REST_URL) endpoints.rest = process.env.QORE_REST_URL;
  if (process.env.QORE_RPC_URL) endpoints.rpc = process.env.QORE_RPC_URL;
  if (process.env.QORE_EVM_RPC_URL) endpoints.evmRpc = process.env.QORE_EVM_RPC_URL;
  return endpoints;
}

export async function main(): Promise<void> {
  // --- Decode events (no node needed) ---
  // A representative event list, as a tx result would surface it. Non-rdk
  // events (e.g. "message") are filtered out by the decoders.
  const sampleEvents: RawEvent[] = [
    {
      type: "message",
      attributes: [{ key: "action", value: "/qorechain.rdk.v1.MsgCreateRollup" }],
    },
    {
      type: "rollup_created",
      attributes: [
        { key: "rollup_id", value: "demo-rollup" },
        { key: "creator", value: "qor1exampleexampleexampleexampleexampleex" },
        { key: "profile", value: "defi" },
      ],
    },
    {
      type: "batch_submitted",
      attributes: [
        { key: "rollup_id", value: "demo-rollup" },
        { key: "batch_index", value: "0" },
      ],
    },
  ];

  const decoded = decodeRdkEvents(sampleEvents);
  console.log(`decoded ${decoded.length} rdk event(s):`);
  for (const e of decoded) {
    console.log(`  ${e.type}:`, e.attributes);
  }

  const created = findRdkEvent(sampleEvents, "rollup_created");
  if (created) {
    console.log(`\nrollup_created → rollup_id = ${created.attributes.rollup_id}`);
  }

  // --- List rollups (needs a node) ---
  if (!process.env.QORE_REST_URL) {
    console.log("\nSet QORE_REST_URL to list registered rollups via client.rest.listRollups().");
    return;
  }
  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const client = createRdkClient({ network, endpoints: envEndpoints() });
  const rollups = await client.rest.listRollups();
  console.log(`\n${rollups.length} rollup(s):`);
  for (const r of rollups) {
    console.log(`  ${r.rollupId} — profile ${r.profile}, status ${r.status}, vm ${r.vmType}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
