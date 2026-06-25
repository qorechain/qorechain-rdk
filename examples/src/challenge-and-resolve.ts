/**
 * Challenge an optimistic settlement batch with a fraud proof, then (in a
 * comment) show how an open challenge is resolved.
 *
 * Optimistic rollups finalize batches after a challenge window unless someone
 * submits a fraud proof showing the posted state transition is invalid.
 * `tx.challengeBatch({ rollupId, batchIndex, proof })` opens that challenge; the
 * client's address is the challenger. A bond is required (see the rollup's
 * `challengeBondUqor`).
 *
 * Resolution is a separate, authority-gated step:
 *
 *   await tx.resolveChallenge({ rollupId, batchIndex, fraudUpheld: true });
 *
 * `fraudUpheld: true` rejects the batch (the challenge succeeded);
 * `fraudUpheld: false` dismisses the challenge and lets the batch proceed.
 *
 * Broadcasting is guarded; by default this example only builds and prints.
 *
 * Run (build-only):
 *   pnpm tsx src/challenge-and-resolve.ts
 * Run (broadcast):
 *   QORE_RPC_URL=... QORE_OPERATOR_PRIVATE_KEY_HEX=... QORE_BROADCAST=1 \
 *     pnpm tsx src/challenge-and-resolve.ts
 */
import { createRdkClient } from "@qorechain/rdk";
import type { CreateRdkClientOptions, RdkTxClient } from "@qorechain/rdk";
import {
  DirectSecp256k1HdWallet,
  DirectSecp256k1Wallet,
} from "@cosmjs/proto-signing";
import type { OfflineSigner } from "@cosmjs/proto-signing";
import { fromHex } from "@cosmjs/encoding";

const PREFIX = "qor";
const ROLLUP_ID = process.env.QORE_ROLLUP_ID ?? "demo-rollup";
const GAS_PRICE = process.env.QORE_GAS_PRICE ?? "0.025uqor";

async function getSigner(): Promise<OfflineSigner> {
  const hex = process.env.QORE_OPERATOR_PRIVATE_KEY_HEX;
  const mnemonic = process.env.QORE_MNEMONIC;
  if (hex) {
    return DirectSecp256k1Wallet.fromKey(fromHex(hex.replace(/^0x/, "")), PREFIX);
  }
  if (mnemonic) {
    return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: PREFIX });
  }
  throw new Error("No signing key found. Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC.");
}

function envEndpoints(): CreateRdkClientOptions["endpoints"] {
  const endpoints: NonNullable<CreateRdkClientOptions["endpoints"]> = {};
  if (process.env.QORE_REST_URL) endpoints.rest = process.env.QORE_REST_URL;
  if (process.env.QORE_RPC_URL) endpoints.rpc = process.env.QORE_RPC_URL;
  if (process.env.QORE_EVM_RPC_URL) endpoints.evmRpc = process.env.QORE_EVM_RPC_URL;
  return endpoints;
}

export async function main(): Promise<void> {
  const batchIndex = 0;
  // The fraud proof comes from your fraud-proving pipeline; illustrative here.
  const proof = `0x${"cc".repeat(48)}`;

  console.log(`Challenging batch ${batchIndex} of rollup "${ROLLUP_ID}"`);
  console.log(`  proof: ${proof}`);

  if (process.env.QORE_BROADCAST !== "1") {
    console.log("\nSet QORE_BROADCAST=1 (with QORE_RPC_URL and a signing key) to broadcast.");
    return;
  }

  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const client = createRdkClient({ network, endpoints: envEndpoints() });
  const signer = await getSigner();
  const tx: RdkTxClient = await client.connectTx(signer, { gasPrice: GAS_PRICE });

  const res = await tx.challengeBatch({ rollupId: ROLLUP_ID, batchIndex, proof });
  console.log(`Challenge submitted: ${res.transactionHash} (code ${res.code})`);

  // Resolution is performed by the authorized resolver:
  //
  //   const r = await tx.resolveChallenge({
  //     rollupId: ROLLUP_ID,
  //     batchIndex,
  //     fraudUpheld: true, // true = reject the batch; false = dismiss the challenge
  //   });
  //   console.log(`Resolved: ${r.transactionHash} (code ${r.code})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
