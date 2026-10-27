import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildHybridTx, deriveNativeAccount, derivePqcCanonical, directSignerFromPrivateKey } from "@qorechain/sdk";
import { bytesToHex, createRdkRegistry, pauseRollupMsg } from "../src/index";

// The cross-language hybrid-signing vectors. Every RDK client must produce
// these exact bytes (ML-DSA-87 signing is deterministic); this pins the
// TypeScript path, which the other clients are checked against.
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/golden.json", import.meta.url)), "utf8"),
);
const h = golden.hybridTx;

describe("hybrid transaction golden vectors", () => {
  for (const [name, version, withKey] of [
    ["v1", "v1", false],
    ["v1WithKey", "v1", true],
    ["v2", "v2", false],
    ["v2WithKey", "v2", true],
  ] as const) {
    it(`${name} is byte-for-byte stable`, async () => {
      const account = await deriveNativeAccount(golden.mnemonic);
      const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
      const [{ address }] = await signer.getAccounts();
      expect(address).toBe(golden.nativeAddress);
      const built = await buildHybridTx({
        registry: createRdkRegistry(),
        signer,
        pqcKeypair: derivePqcCanonical(address, golden.mnemonic),
        messages: [pauseRollupMsg({ creator: address, rollupId: h.message.rollupId })],
        fee: h.fee,
        memo: h.memo,
        chainId: h.chainId,
        accountNumber: h.accountNumber,
        sequence: h.sequence,
        signBytesVersion: version,
        includePqcPublicKey: withKey,
      });
      expect(bytesToHex(built.pqcSignedMessage)).toBe(h[name].pqcSignedMessageHex);
      expect(bytesToHex(built.txRawBytes)).toBe(h[name].txRawHex);
    });
  }
});
