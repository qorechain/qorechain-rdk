import { describe, it, expect } from "vitest";
import { createRdkClient, RdkTxClient, MockTxClient, generateMnemonic, type FetchLike } from "@qorechain/rdk";
import { CaptureOutput } from "../src/output";
import { parseCli } from "../src/args";
import * as cmd from "../src/commands";
import type { CliContext, CliEnv } from "../src/context";

interface Reply {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json: unknown;
}

function makeCtx(
  handler: (req: { url: string; init?: { body?: string } }) => Reply,
  opts: { signerEnv?: CliEnv; yes?: boolean } = {},
) {
  const fetch: FetchLike = async (url, init) => {
    const r = handler({ url, init });
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.statusText ?? "OK",
      json: async () => r.json,
    };
  };
  const client = createRdkClient({ endpoints: { rest: "https://r", evmRpc: "https://e" }, fetch });
  const out = new CaptureOutput();
  const mock = new MockTxClient();
  const ctx: CliContext = {
    client,
    out,
    json: false,
    yes: opts.yes ?? true,
    network: "testnet",
    signerEnv: opts.signerEnv ?? {},
    gasPrice: "0.15uqor",
    faucetUrl: "https://faucet.example",
    fetch,
    connectTx: async () => RdkTxClient.fromClient(mock, "qor1me"),
  };
  return { ctx, out, mock };
}

const PARAMS = {
  params: {
    max_rollups: 100,
    min_stake_for_rollup: "10000000000",
    rollup_creation_burn_rate: "0.01",
    default_challenge_window: 604800,
    max_da_blob_size: 2097152,
    blob_retention_blocks: 432000,
    max_batches_per_block: 10,
  },
};

describe("qorollup commands", () => {
  it("params prints live module parameters", async () => {
    const { ctx, out } = makeCtx(() => ({ json: PARAMS }));
    expect(await cmd.cmdParams(ctx)).toBe(0);
    expect(out.text()).toMatch(/min stake:\s+10000 QOR/);
  });

  it("create --dry-run validates + costs without broadcasting", async () => {
    const { ctx, out, mock } = makeCtx(() => ({ json: PARAMS }));
    const code = await cmd.cmdCreate(ctx, parseCli(["create", "--rollup-id", "d", "--profile", "defi", "--dry-run"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("Dry run OK");
    expect(mock.calls).toHaveLength(0);
  });

  it("create broadcasts via the signing client", async () => {
    const { ctx, out, mock } = makeCtx(() => ({ json: PARAMS }));
    const code = await cmd.cmdCreate(ctx, parseCli(["create", "--rollup-id", "d", "--profile", "defi"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("Created");
    expect(mock.calls[0].messages[0].typeUrl).toBe("/qorechain.rdk.v1.MsgCreateRollup");
  });

  it("doctor passes with a funded signer", async () => {
    const mnemonic = generateMnemonic();
    const { ctx, out } = makeCtx(
      (req) => {
        if (req.url.includes("/by_denom")) return { json: { balance: { denom: "uqor", amount: "20000000000" } } };
        return { json: PARAMS };
      },
      { signerEnv: { QORE_MNEMONIC: mnemonic } },
    );
    const code = await cmd.cmdDoctor(ctx, parseCli(["doctor"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("All checks passed");
  });

  it("doctor fails on insufficient balance", async () => {
    const mnemonic = generateMnemonic();
    const { ctx } = makeCtx(
      (req) => {
        if (req.url.includes("/by_denom")) return { json: { balance: { denom: "uqor", amount: "1" } } };
        return { json: PARAMS };
      },
      { signerEnv: { QORE_MNEMONIC: mnemonic } },
    );
    expect(await cmd.cmdDoctor(ctx, parseCli(["doctor"]))).toBe(1);
  });

  it("suggest prints a profile from the advisory", async () => {
    const { ctx, out } = makeCtx(() => ({ json: { result: "gaming" } }));
    const code = await cmd.cmdSuggest(ctx, parseCli(["suggest", "real-time", "game"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("gaming");
  });

  it("pause fetches status then broadcasts the lifecycle tx", async () => {
    const { ctx, mock } = makeCtx((req) => {
      if (req.url.includes("/rollup/")) return { json: { rollup: { status: "active" } } };
      return { json: {} };
    });
    const code = await cmd.cmdLifecycle(ctx, parseCli(["pause", "d"]), "pause");
    expect(code).toBe(0);
    expect(mock.calls[0].messages[0].typeUrl).toBe("/qorechain.rdk.v1.MsgPauseRollup");
  });

  it("status prints rollup + health", async () => {
    const { ctx, out } = makeCtx((req) => {
      if (req.url.includes("?latest=true"))
        return { json: { batch: { batch_index: 2, status: "finalized", submitted_at: 1000 } } };
      if (req.url.includes("/rollup/")) return { json: { rollup: { status: "active", profile: "defi" } } };
      return { json: PARAMS };
    });
    const code = await cmd.cmdStatus(ctx, parseCli(["status", "d"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("Rollup d");
  });

  it("keygen prints a mnemonic and address", async () => {
    const { ctx, out } = makeCtx(() => ({ json: {} }));
    expect(await cmd.cmdKeygen(ctx)).toBe(0);
    expect(out.text()).toContain("address:");
    expect(out.text()).toContain("mnemonic:");
  });

  it("manifest export emits a manifest", async () => {
    const { ctx, out } = makeCtx(() => ({ json: {} }));
    const code = await cmd.cmdManifest(ctx, parseCli(["manifest", "export", "--rollup-id", "d", "--profile", "defi"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("qorechain-rdk/rollup-manifest");
  });

  it("faucet posts to the configured URL", async () => {
    const { ctx, out } = makeCtx(() => ({ json: { ok: true } }));
    const code = await cmd.cmdFaucet(ctx, parseCli(["faucet", "qor1abc"]));
    expect(code).toBe(0);
    expect(out.text()).toContain("Faucet request accepted");
  });
});
