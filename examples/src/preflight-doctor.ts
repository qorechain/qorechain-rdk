/**
 * Preflight ("doctor") — verify you're ready to create/operate a rollup:
 * endpoints reachable, params readable, signer configured, balance sufficient,
 * and (optionally) a config valid. Mirrors `qorollup doctor`.
 *
 * Run: pnpm tsx src/preflight-doctor.ts
 */
import { createRdkClient, checkPreflight, presets, signerFromEnv } from "@qorechain/rdk";

export async function main(): Promise<void> {
  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const endpoints: { rest?: string; rpc?: string; evmRpc?: string } = {};
  if (process.env.QORE_REST_URL) endpoints.rest = process.env.QORE_REST_URL;
  if (process.env.QORE_EVM_RPC_URL) endpoints.evmRpc = process.env.QORE_EVM_RPC_URL;
  const client = createRdkClient({ network, endpoints });

  const signer = await signerFromEnv();
  const signerAddress = signer ? (await signer.getAccounts())[0]?.address : undefined;

  const result = await checkPreflight(client, {
    config: presets.defi({ rollupId: "my-defi-rollup" }).get(),
    signerAddress,
    expectedNetwork: network,
  });

  for (const c of result.checks) {
    const mark = c.status === "ok" ? "OK" : c.status === "warn" ? "!!" : "XX";
    console.log(`${mark} ${c.label}${c.detail ? " — " + c.detail : ""}`);
  }
  console.log(result.ok ? "All checks passed." : "Some checks failed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
