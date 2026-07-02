/**
 * Build a `submitBatch` message for each settlement path and (optionally)
 * broadcast it.
 *
 * A settlement batch commits to the rollup's new state root and the hash of its
 * data; what proof it carries depends on the settlement paradigm:
 *
 *   - optimistic → a fraud proof is only supplied later, when challenged; the
 *     batch itself is submitted WITHOUT a proof and finalizes after the
 *     challenge window. (We pass illustrative fraud-proof bytes here only to
 *     show the field shape; in practice optimistic batches omit `proof`.)
 *   - zk         → carries a validity proof (snark/stark bytes) in `proof`.
 *   - based      → no proof; ordering/inclusion is inherited from the host.
 *   - sovereign  → no proof; settlement is verified off the Main Chain.
 *
 * The shapes below all type-check against `RdkTxClient.submitBatch`. Actual
 * broadcasting is guarded so it only runs when a node + signer are configured.
 *
 * Run (build-only, no broadcast):
 *   pnpm tsx src/submit-batch-paths.ts
 * Run (broadcast):
 *   QORE_RPC_URL=... QORE_OPERATOR_PRIVATE_KEY_HEX=... QORE_BROADCAST=1 \
 *     pnpm tsx src/submit-batch-paths.ts
 */
import { createRdkClient, buildDaBlob } from "@qorechain/rdk";
import type { CreateRdkClientOptions, RdkTxClient, SubmitBatchInput } from "@qorechain/rdk";
import {
  DirectSecp256k1HdWallet,
  DirectSecp256k1Wallet,
} from "@cosmjs/proto-signing";
import type { OfflineSigner } from "@cosmjs/proto-signing";
import { fromHex } from "@cosmjs/encoding";

const PREFIX = "qor";
const ROLLUP_ID = process.env.QORE_ROLLUP_ID ?? "demo-rollup";
const GAS_PRICE = process.env.QORE_GAS_PRICE ?? "0.15uqor";

/** Build an offline signer from QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC. */
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

/** The per-path batch inputs (the sequencer address is filled in by the client). */
type BatchInput = Omit<SubmitBatchInput, "sequencer">;

export async function main(): Promise<void> {
  // Roots and data are illustrative fixed values; a real rollup derives them
  // from its execution layer.
  const stateRoot = `0x${"11".repeat(32)}`;
  const prevStateRoot = `0x${"00".repeat(32)}`;
  const blob = buildDaBlob({ data: new TextEncoder().encode("example batch data") });

  // Reference proof bytes for the paths that carry one.
  const fraudProof = `0x${"aa".repeat(32)}`; // optimistic fraud-proof bytes (supplied on challenge)
  const snarkProof = `0x${"bb".repeat(64)}`; // zk validity proof bytes

  const base = {
    rollupId: ROLLUP_ID,
    batchIndex: 0,
    stateRoot,
    prevStateRoot,
    txCount: 1,
    dataHash: blob.dataHash,
  } satisfies Omit<BatchInput, "proof">;

  const paths: Record<string, BatchInput> = {
    // Optimistic: the batch is submitted without a proof; a fraud proof is only
    // produced if it is challenged (see challenge-and-resolve.ts).
    optimistic: { ...base, proof: fraudProof },
    // ZK: carries a validity (snark) proof verified on-chain before finalizing.
    zk: { ...base, proof: snarkProof },
    // Based: no proof — inclusion is inherited from the host chain.
    based: { ...base },
    // Sovereign: no proof on the Main Chain.
    sovereign: { ...base },
  };

  for (const [path, input] of Object.entries(paths)) {
    console.log(`settlement path "${path}":`);
    console.log(`  rollupId:  ${input.rollupId}`);
    console.log(`  dataHash:  ${input.dataHash}`);
    console.log(`  proof:     ${input.proof ? "present" : "none"}`);
  }

  if (process.env.QORE_BROADCAST !== "1") {
    console.log("\nSet QORE_BROADCAST=1 (with QORE_RPC_URL and a signing key) to broadcast.");
    return;
  }

  // Live broadcast path. Connect a signing tx client and submit each batch.
  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const client = createRdkClient({ network, endpoints: envEndpoints() });
  const signer = await getSigner();
  const tx: RdkTxClient = await client.connectTx(signer, { gasPrice: GAS_PRICE });

  for (const [path, input] of Object.entries(paths)) {
    const res = await tx.submitBatch(input);
    console.log(`broadcast "${path}": ${res.transactionHash} (code ${res.code})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
