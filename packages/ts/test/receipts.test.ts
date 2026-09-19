import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import {
  anchorSignBytes,
  buildSettlementReceipt,
  verifySettlementReceipt,
  createRdkClient,
  bytesToHex,
  bytesToBase64,
  hexToBytes,
  type SettlementReceipt,
} from "../src/index";
import { mockFetch } from "./mock-fetch";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/golden.json", import.meta.url)), "utf8"),
);

describe("anchorSignBytes", () => {
  it("matches the golden canonical-message vector", () => {
    const g = golden.anchorSignBytes;
    const bytes = anchorSignBytes({
      layerId: g.layerId,
      layerHeight: g.layerHeight,
      stateRoot: g.stateRoot,
      validatorSetHash: g.validatorSetHash,
    });
    expect(bytesToHex(bytes)).toBe(g.expectedHex);
  });
});

describe("settlement receipts (round-trip, real ML-DSA-87)", () => {
  const layerId = "layer-rollup-1";
  const layerHeight = 42;
  const stateRoot = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d";
  const vsh = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  const creator = "qor1creator0000000000000000000000000000000";

  const kp = generatePqcKeypair();
  const message = anchorSignBytes({ layerId, layerHeight, stateRoot, validatorSetHash: vsh });
  const signature = pqcSign(kp.secretKey, message);

  const b64 = (hex: string): string => bytesToBase64(hexToBytes(hex));

  function client(sigBytes: Uint8Array = signature) {
    const { fetch } = mockFetch((call) => {
      const u = call.url;
      if (u.includes("/qorechain/rdk/v1/rollup/")) {
        return {
          json: { rollup: { rollup_id: "r", creator, layer_id: layerId, status: "active" } },
        };
      }
      if (u.includes("/qorechain/rdk/v1/batch/")) {
        return { json: { batch: { rollup_id: "r", batch_index: 0, state_root: b64(stateRoot), status: "finalized" } } };
      }
      if (u.includes("/qorechain/multilayer/v1/anchors/")) {
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
                pqc_aggregate_signature: bytesToBase64(sigBytes),
                transaction_count: 7,
              },
            ],
          },
        };
      }
      if (u.includes("/qorechain/pqc/v1/accounts/")) {
        return { json: { account: { address: creator, public_key: bytesToBase64(kp.publicKey), algorithm_name: "ML-DSA-87" } } };
      }
      return { json: {} };
    });
    return createRdkClient({ network: "testnet", endpoints: { rest: "http://node" }, fetch });
  }

  it("builds a receipt binding the batch root to the anchor", async () => {
    const receipt = await buildSettlementReceipt(client(), "r", 0);
    expect(receipt.layerId).toBe(layerId);
    expect(receipt.stateRoot).toBe(stateRoot);
    expect(receipt.batchStateRoot).toBe(stateRoot);
    expect(receipt.algorithm).toBe("ML-DSA-87");
    expect(receipt.creator).toBe(creator);
  });

  it("verifies against chain state", async () => {
    const c = client();
    const receipt = await buildSettlementReceipt(c, "r", 0);
    const v = await verifySettlementReceipt(receipt, { client: c });
    expect(v.valid).toBe(true);
    expect(v.mode).toBe("chain");
    expect(v.checks.rollupLayerBinding).toBe(true);
    expect(v.checks.batchStateRoot).toBe(true);
    expect(v.checks.anchorOnChain).toBe(true);
    expect(v.checks.creatorAuthority).toBe(true);
    expect(v.checks.pqcSignature).toBe(true);
  });

  it("signature-only is never valid, even for a genuine receipt", async () => {
    const receipt = await buildSettlementReceipt(client(), "r", 0);
    const v = await verifySettlementReceipt(receipt, { creatorPublicKey: bytesToHex(kp.publicKey) });
    expect(v.checks.pqcSignature).toBe(true); // the signature really is good
    expect(v.valid).toBe(false); // but nothing was checked against the chain
    expect(v.mode).toBe("signature-only");
  });

  it("refuses to verify with no client at all", async () => {
    const receipt = await buildSettlementReceipt(client(), "r", 0);
    const v = await verifySettlementReceipt(receipt);
    expect(v.valid).toBe(false);
    expect(v.mode).toBe("signature-only");
  });

  it("rejects a tampered signature against the chain", async () => {
    const bad = signature.slice();
    bad[10] ^= 0xff;
    const c = client(bad);
    const receipt = await buildSettlementReceipt(c, "r", 0);
    const v = await verifySettlementReceipt(receipt, { client: c });
    expect(v.valid).toBe(false);
    expect(v.checks.pqcSignature).toBe(false);
  });

  // QSR-2026-0055 regression: a receipt is a claim, not evidence.
  it("rejects a fabricated receipt signed by an attacker's own key", async () => {
    const evil = generatePqcKeypair();
    const fake: SettlementReceipt = {
      version: 1,
      rollupId: "victim-rollup",
      layerId: "layer-victim",
      batchIndex: 999,
      creator: "qor1attackerownaddressxxxxxxxxxxxxxxxxxxx",
      algorithm: "ML-DSA-87",
      stateRoot: "de".repeat(32),
      layerHeight: 123456,
      validatorSetHash: "ab".repeat(32),
      mainChainHeight: 999999,
      anchoredAt: 1757000000,
      pqcSignature: "",
      batchStateRoot: "de".repeat(32), // attacker controls both sides of the old "binding"
    };
    fake.pqcSignature = bytesToHex(pqcSign(evil.secretKey, anchorSignBytes(fake)));

    // Signature-only: the signature is internally consistent, but proves nothing.
    const sigOnly = await verifySettlementReceipt(fake, {
      creatorPublicKey: bytesToHex(evil.publicKey),
    });
    expect(sigOnly.checks.pqcSignature).toBe(true);
    expect(sigOnly.valid).toBe(false);

    // Against the chain: the rollup/layer does not exist, so it cannot pass.
    const v = await verifySettlementReceipt(fake, { client: client() });
    expect(v.valid).toBe(false);
    expect(v.mode).toBe("chain");
  });
});
