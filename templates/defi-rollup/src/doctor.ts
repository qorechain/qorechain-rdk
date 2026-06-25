import "dotenv/config";
import { checkPreflight, signerFromEnv } from "@qorechain/rdk";
import { getClient, ROLLUP_ID } from "./client.js";
import { buildConfig } from "../rollup.config.js";

async function main(): Promise<void> {
  const client = getClient();
  const signer = await signerFromEnv();
  const signerAddress = signer ? (await signer.getAccounts())[0]?.address : undefined;
  const result = await checkPreflight(client, {
    config: buildConfig().get(),
    signerAddress,
    expectedNetwork: (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet",
  });
  for (const c of result.checks)
    console.log(
      `${c.status === "ok" ? "OK " : c.status === "warn" ? "!! " : "XX "} ${c.label}${c.detail ? " — " + c.detail : ""}${c.hint ? " (" + c.hint + ")" : ""}`,
    );
  console.log(result.ok ? "All checks passed." : "Some checks failed.");
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
