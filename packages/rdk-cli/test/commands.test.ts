import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import {
  createRdkClient,
  RdkTxClient,
  MockTxClient,
  anchorSignBytes,
  bytesToBase64,
  bytesToHex,
  generateMnemonic,
  hexToBytes,
  type FetchLike,
  type SettlementReceipt,
} from "@qorechain/rdk";
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

describe("qorollup receipt verify (a receipt someone handed you)", () => {
  const layerId = "layer-rollup-1";
  const layerHeight = 42;
  const stateRoot = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d";
  const vsh = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  const creator = "qor1creator0000000000000000000000000000000";

  const kp = generatePqcKeypair();
  const signature = pqcSign(
    kp.secretKey,
    anchorSignBytes({ layerId, layerHeight, stateRoot, validatorSetHash: vsh }),
  );
  const b64 = (hex: string): string => bytesToBase64(hexToBytes(hex));

  /** A node that holds exactly one rollup, one batch and one anchor. */
  function chain(): (req: { url: string }) => Reply {
    return ({ url }) => {
      if (url.includes("/qorechain/rdk/v1/rollup/")) {
        return { json: { rollup: { rollup_id: "r", creator, layer_id: layerId, status: "active" } } };
      }
      if (url.includes("/qorechain/rdk/v1/batch/")) {
        return {
          json: {
            batch: { rollup_id: "r", batch_index: 0, state_root: b64(stateRoot), status: "finalized" },
          },
        };
      }
      if (url.includes("/qorechain/multilayer/v1/anchors/")) {
        return {
          json: {
            anchors: [
              {
                layer_id: layerId,
                layer_height: layerHeight,
                state_root: b64(stateRoot),
                validator_set_hash: b64(vsh),
                main_chain_height: 100,
                anchored_at: 1700000000,
                pqc_aggregate_signature: bytesToBase64(signature),
                transaction_count: 7,
              },
            ],
          },
        };
      }
      if (url.includes("/qorechain/pqc/v1/accounts/")) {
        return {
          json: {
            account: {
              address: creator,
              public_key: bytesToBase64(kp.publicKey),
              algorithm_name: "ML-DSA-87",
            },
          },
        };
      }
      return { json: {} };
    };
  }

  const genuine: SettlementReceipt = {
    version: 1,
    rollupId: "r",
    layerId,
    batchIndex: 0,
    creator,
    algorithm: "ML-DSA-87",
    stateRoot,
    layerHeight,
    validatorSetHash: vsh,
    mainChainHeight: 100,
    anchoredAt: 1700000000,
    pqcSignature: bytesToHex(signature),
    batchStateRoot: stateRoot,
  };

  function writeReceipt(value: unknown): string {
    const file = join(mkdtempSync(join(tmpdir(), "qorollup-receipt-")), "receipt.json");
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  }

  async function run(fileArg: string | undefined, handler = chain()) {
    const { ctx, out } = makeCtx(handler);
    const argv = fileArg === undefined ? ["receipt", "verify"] : ["receipt", "verify", fileArg];
    const code = await cmd.cmdReceipt(ctx, parseCli(argv));
    // CaptureOutput keeps error() separate from line(); assertions want both.
    return { code, text: [...out.lines, ...out.errors].join("\n") };
  }

  it("verifies a genuine receipt read from a file", async () => {
    const { code, text } = await run(writeReceipt(genuine));
    expect(code).toBe(0);
    expect(text).toContain("Receipt is genuine");
    // Every check is reported, so a relying party sees what was actually proven.
    expect(text).toContain("PASS  a matching anchor exists on chain");
    expect(text).not.toContain("FAIL");
  });

  it("rejects a receipt an attacker fabricated and signed with their own key (QSR-2026-0055)", async () => {
    // The attacker invents a state root and signs the canonical anchor message
    // with a keypair they generated themselves — the original PoC, now arriving
    // the way a relying party would really receive it: as a file.
    const evilKp = generatePqcKeypair();
    const fakeRoot = "dead".repeat(16);
    const forged: SettlementReceipt = {
      ...genuine,
      stateRoot: fakeRoot,
      batchStateRoot: fakeRoot,
      pqcSignature: bytesToHex(
        pqcSign(
          evilKp.secretKey,
          anchorSignBytes({ layerId, layerHeight, stateRoot: fakeRoot, validatorSetHash: vsh }),
        ),
      ),
    };
    const { code, text } = await run(writeReceipt(forged));
    expect(code).toBe(1);
    expect(text).toContain("NOT verified");
    expect(text).toContain("FAIL  chain's batch carries the receipt's state root");
  });

  it("reports a clear error for a malformed file instead of a verification failure", async () => {
    const { code, text } = await run(writeReceipt("{ not json"));
    expect(code).toBe(1);
    expect(text).toContain("not valid JSON");
  });

  it("names the fields a truncated receipt is missing", async () => {
    const { pqcSignature, stateRoot: _root, ...partial } = genuine;
    void pqcSignature;
    void _root;
    const { code, text } = await run(writeReceipt(partial));
    expect(code).toBe(1);
    expect(text).toContain("missing required field(s)");
    expect(text).toContain("stateRoot");
    expect(text).toContain("pqcSignature");
  });

  it("prints usage when no file is given", async () => {
    const { code, text } = await run(undefined);
    expect(code).toBe(1);
    expect(text).toContain("qorollup receipt verify <file>");
  });
});
