import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import {
  anchorSignBytes,
  anchorSignBytesV1,
  anchorSignBytesV2,
  anchorSignBytesVersionFor,
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
      if (u.includes("/qorechain/pqc/v1/account/")) {
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

describe("anchor sign bytes v2 (chain v3.2.2 and later)", () => {
  const g = golden.anchorSignBytes;

  it("matches the vector generated by the chain's own implementation", () => {
    const v = g.v2;
    expect(
      bytesToHex(
        anchorSignBytesV2({
          chainId: v.chainId,
          layerId: v.layerId,
          layerHeight: v.layerHeight,
          stateRoot: v.stateRoot,
          validatorSetHash: v.validatorSetHash,
          transactionCount: v.transactionCount,
          compressedStateProof: v.compressedStateProof,
        }),
      ),
    ).toBe(v.expectedHex);
  });

  it("still matches the v1 vector, for anchors written before the switch", () => {
    expect(bytesToHex(anchorSignBytesV1(g))).toBe(g.expectedHexV1);
  });

  it("binds the chain id, so the same anchor signs differently per network", () => {
    const base = {
      layerId: g.layerId,
      layerHeight: g.layerHeight,
      stateRoot: g.stateRoot,
      validatorSetHash: g.validatorSetHash,
      transactionCount: 7,
    };
    const diana = bytesToHex(anchorSignBytesV2({ ...base, chainId: "qorechain-diana" }));
    const vladi = bytesToHex(anchorSignBytesV2({ ...base, chainId: "qorechain-vladi" }));
    expect(diana).not.toBe(vladi);
    // This is the v1 weakness v2 closes: v1 has no chain id at all.
    expect(bytesToHex(anchorSignBytesV1(base))).toBe(g.expectedHexV1);
  });

  it("refuses to build v2 without the fields the signature covers", () => {
    expect(() => anchorSignBytes({ ...g, transactionCount: 7 }, "v2")).toThrow(/chainId/);
    expect(() => anchorSignBytes({ ...g, chainId: "qorechain-diana" }, "v2")).toThrow(
      /transactionCount/,
    );
  });

  it("picks the form by the anchor's height against the network's switch", () => {
    expect(anchorSignBytesVersionFor(6_905_033, 6_905_034)).toBe("v1");
    expect(anchorSignBytesVersionFor(6_905_034, 6_905_034)).toBe("v2");
    expect(anchorSignBytesVersionFor(9_000_000, 6_905_034)).toBe("v2");
    // A fresh chain enables the feature at genesis.
    expect(anchorSignBytesVersionFor(1, 0)).toBe("v2");
  });
});

describe("settlement receipts on a v2 network", () => {
  const layerId = "layer-rollup-1";
  const batchIndex = 42; // layer_height is the batch index for a batch anchor
  const stateRoot = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d";
  const vsh = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  const creator = "qor1creator0000000000000000000000000000000";
  const txCount = 7;
  // Comfortably above diana's rdk-integrity height, so v2 is in force.
  const anchoredAtHeight = 7_000_000;

  const kp = generatePqcKeypair();
  const b64 = (hex: string): string => bytesToBase64(hexToBytes(hex));

  function client(chainId = "qorechain-diana", sig?: Uint8Array) {
    const signature =
      sig ??
      pqcSign(
        kp.secretKey,
        anchorSignBytesV2({
          chainId,
          layerId,
          layerHeight: batchIndex,
          stateRoot,
          validatorSetHash: vsh,
          transactionCount: txCount,
          compressedStateProof: "",
        }),
      );
    const { fetch } = mockFetch((call) => {
      const u = call.url;
      if (u.includes("/qorechain/rdk/v1/rollup/")) {
        return { json: { rollup: { rollup_id: "r", creator, layer_id: layerId, status: "active" } } };
      }
      if (u.includes("/qorechain/rdk/v1/batch/")) {
        return {
          json: {
            batch: { rollup_id: "r", batch_index: batchIndex, state_root: b64(stateRoot), status: "finalized" },
          },
        };
      }
      if (u.includes("/qorechain/multilayer/v1/anchors/")) {
        return {
          json: {
            anchors: [
              {
                layer_id: layerId,
                layer_height: batchIndex,
                state_root: b64(stateRoot),
                validator_set_hash: b64(vsh),
                main_chain_height: anchoredAtHeight,
                anchored_at: 1700000000,
                pqc_aggregate_signature: bytesToBase64(signature),
                transaction_count: txCount,
              },
            ],
          },
        };
      }
      if (u.includes("/qorechain/pqc/v1/account/")) {
        return {
          json: {
            account: { address: creator, public_key: bytesToBase64(kp.publicKey), algorithm_name: "ML-DSA-87" },
          },
        };
      }
      return { json: {} };
    });
    return createRdkClient({ network: "testnet", endpoints: { rest: "http://node" }, fetch });
  }

  it("builds a receipt that records the chain it came from", async () => {
    const receipt = await buildSettlementReceipt(client(), "r", batchIndex);
    expect(receipt.version).toBe(2);
    expect(receipt.chainId).toBe("qorechain-diana");
    expect(receipt.transactionCount).toBe(txCount);
  });

  it("verifies a v2-signed anchor and says which form it used", async () => {
    const c = client();
    const receipt = await buildSettlementReceipt(c, "r", batchIndex);
    const v = await verifySettlementReceipt(receipt, { client: c });
    expect(v.valid).toBe(true);
    expect(v.signBytesVersion).toBe("v2");
    expect(v.checks.chainBinding).toBe(true);
    expect(v.checks.pqcSignature).toBe(true);
  });

  it("refuses a receipt whose anchor was signed with v1 bytes above the switch", async () => {
    // A signature over the OLD message, presented for an anchor the chain
    // recorded after the switch. v1 carries no chain id, so accepting it here
    // would re-admit a signature that is valid on every chain.
    const v1sig = pqcSign(
      kp.secretKey,
      anchorSignBytesV1({ layerId, layerHeight: batchIndex, stateRoot, validatorSetHash: vsh }),
    );
    const c = client("qorechain-diana", v1sig);
    const receipt = await buildSettlementReceipt(c, "r", batchIndex);
    const v = await verifySettlementReceipt(receipt, { client: c });
    expect(v.valid).toBe(false);
    expect(v.signBytesVersion).toBe("v2");
    expect(v.reason).toMatch(/did not verify/);
  });

  it("refuses a mainnet receipt checked against a testnet node", async () => {
    const c = client();
    const receipt = await buildSettlementReceipt(c, "r", batchIndex);
    const moved = { ...receipt, chainId: "qorechain-vladi" };
    const v = await verifySettlementReceipt(moved, { client: c });
    expect(v.valid).toBe(false);
    expect(v.checks.chainBinding).toBe(false);
    expect(v.reason).toMatch(/qorechain-vladi.*qorechain-diana|own network/s);
  });
});
