import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bytesToHex, createRdkClient, hexToBech32, MockTxClient, RdkTxClient, withdrawalsTree, type FetchLike } from "@qorechain/rdk";
import * as cmd from "../src/commands";
import { parseCli } from "../src/args";
import { CaptureOutput } from "../src/output";
import type { CliContext } from "../src/context";

// The withdrawals and root the chain's own verifier accepted (golden fixture).
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/golden.json", import.meta.url)), "utf8"),
);
const w = golden.withdrawalTree;
// The fixture's recipients are labels, not bech32 addresses, and the RDK
// refuses an invalid recipient before broadcasting; use real addresses here.
// The leaves and proofs themselves are checked against the chain's vectors in
// the core package's tests.
const addr = (n: number) => hexToBech32(n.toString(16).padStart(40, "0"));
const items = w.withdrawals.map((x: { amount: number }, i: number) => ({ recipient: addr(i + 1), denom: w.denom, amount: x.amount }));
const SUBMITTER = addr(99);
const rootOf = (version: "v1" | "v2") =>
  bytesToHex(withdrawalsTree(items, { rollupId: w.rollupId, version, chainId: "qorechain-diana" }).root);
const proofOf = (version: "v1" | "v2", i: number) =>
  withdrawalsTree(items, { rollupId: w.rollupId, version, chainId: "qorechain-diana" }).proof(i).proof.map(bytesToHex);

function ctxFor(batchWithdrawalsRoot: string, submittedAt: number) {
  const fetch: FetchLike = async (url) => {
    const body = url.includes("/qorechain/rdk/v1/batch/")
      ? { batch: { batch_index: 0, status: "finalized", withdrawals_root: batchWithdrawalsRoot, submitted_at: submittedAt } }
      : url.endsWith("/applied_plan/v3.2.5")
        ? { height: "8890800" }
        : {};
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  const out = new CaptureOutput();
  const mock = new MockTxClient();
  const ctx: CliContext = {
    client: createRdkClient({ network: "testnet", endpoints: { rest: "https://r" }, fetch }),
    out,
    json: false,
    yes: true,
    network: "testnet",
    signerEnv: {},
    gasPrice: "0.15uqor",
    faucetUrl: "https://faucet.example",
    fetch,
    connectTx: async () => RdkTxClient.fromClient(mock, SUBMITTER),
  };
  return { ctx, out, mock };
}

function specFile(index: number) {
  const file = join(mkdtempSync(join(tmpdir(), "qorollup-withdraw-")), "w.json");
  writeFileSync(file, JSON.stringify({ rollupId: w.rollupId, batchIndex: 0, index, withdrawals: items }));
  return file;
}

describe("qorollup withdraw --file (chain-exact withdrawals)", () => {
  it("builds the batch's v2 proof from its withdrawals and submits it", async () => {
    const { ctx, mock } = ctxFor(rootOf("v2"), 8_890_801);
    const code = await cmd.cmdWithdraw(ctx, parseCli(["withdraw", "--file", specFile(3)]));
    expect(code).toBe(0);
    const msg = mock.calls[0].messages[0].value as { proof: Uint8Array[]; recipient: string };
    expect(msg.recipient).toBe(addr(4));
    expect(msg.proof.map((p) => Buffer.from(p).toString("hex"))).toEqual(proofOf("v2", 3));
  });

  it("uses v1 leaves for a batch submitted before v3.2.5", async () => {
    const { ctx, mock } = ctxFor(rootOf("v1"), 8_000_000);
    expect(await cmd.cmdWithdraw(ctx, parseCli(["withdraw", "--file", specFile(1)]))).toBe(0);
    const msg = mock.calls[0].messages[0].value as { proof: Uint8Array[] };
    expect(msg.proof.map((p) => Buffer.from(p).toString("hex"))).toEqual(proofOf("v1", 1));
  });

  it("refuses before paying when the root is not the batch's", async () => {
    const { ctx, out, mock } = ctxFor(rootOf("v1"), 8_890_801); // a v2 batch committing a v1 root
    expect(await cmd.cmdWithdraw(ctx, parseCli(["withdraw", "--file", specFile(0)]))).toBe(1);
    expect(mock.calls).toHaveLength(0);
    expect(out.errors.join(" ")).toMatch(/would refuse this proof/);
  });
});
