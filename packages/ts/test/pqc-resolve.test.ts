import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { derivePqcCanonical, derivePqcLegacy, generatePqcKeypair } from "@qorechain/sdk";
import {
  createRdkClient,
  resolvePqcKeypair,
  pqcKeypairFromEnv,
  bytesToBase64,
  bytesToHex,
} from "../src/index";
import { mockFetch } from "./mock-fetch";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/golden.json", import.meta.url)), "utf8"),
);
const mnemonic: string = golden.mnemonic;
const address: string = golden.nativeAddress;

/** A node whose PQC account for `address` holds `registered` (or nothing). */
function clientWith(registered?: Uint8Array) {
  const { fetch } = mockFetch((call) => {
    if (call.url.includes("/qorechain/pqc/v1/account/")) {
      return registered
        ? { json: { found: true, account: { address, public_key: bytesToBase64(registered) } } }
        : { json: { found: false } };
    }
    return { json: {} };
  });
  return createRdkClient({ network: "testnet", endpoints: { rest: "http://node" }, fetch });
}

const canonical = derivePqcCanonical(address, mnemonic);
const legacy = derivePqcLegacy(mnemonic);

describe("resolvePqcKeypair — use the key the chain actually has", () => {
  it("the two derivations really differ, so choosing between them matters", () => {
    expect(bytesToHex(canonical.publicKey)).not.toBe(bytesToHex(legacy.publicKey));
  });

  it("returns the canonical key, set to register on first use, when none is registered", async () => {
    const r = await resolvePqcKeypair(clientWith(), address, mnemonic);
    expect(r.derivation).toBe("canonical");
    expect(r.registered).toBe(false);
    expect(r.includePqcPublicKey).toBe(true);
    expect(bytesToHex(r.keypair.publicKey)).toBe(bytesToHex(canonical.publicKey));
  });

  it("returns the canonical key when that is what is registered", async () => {
    const r = await resolvePqcKeypair(clientWith(canonical.publicKey), address, mnemonic);
    expect(r.derivation).toBe("canonical");
    expect(r.registered).toBe(true);
    expect(r.includePqcPublicKey).toBe(false);
  });

  it("returns the LEGACY key when that is what is registered", async () => {
    // The case a canonical-only template would have got wrong: every
    // transaction it signed would have been refused.
    const r = await resolvePqcKeypair(clientWith(legacy.publicKey), address, mnemonic);
    expect(r.derivation).toBe("legacy");
    expect(bytesToHex(r.keypair.publicKey)).toBe(bytesToHex(legacy.publicKey));
  });

  it("refuses to guess when the registered key matches neither", async () => {
    const stranger = generatePqcKeypair(new Uint8Array(32).fill(9));
    await expect(resolvePqcKeypair(clientWith(stranger.publicKey), address, mnemonic)).rejects.toThrow(
      /neither the canonical nor the legacy/,
    );
  });
});

describe("pqcKeypairFromEnv", () => {
  it("prefers an explicit seed, and checks it against the chain", async () => {
    const seed = new Uint8Array(32).fill(5);
    const fromSeed = generatePqcKeypair(seed);
    const r = await pqcKeypairFromEnv(clientWith(fromSeed.publicKey), address, {
      QORE_PQC_SEED_HEX: bytesToHex(seed),
      QORE_MNEMONIC: mnemonic,
    });
    expect(r?.derivation).toBe("seed");
    expect(r?.registered).toBe(true);
  });

  it("refuses a seed that does not produce the registered key", async () => {
    await expect(
      pqcKeypairFromEnv(clientWith(canonical.publicKey), address, {
        QORE_PQC_SEED_HEX: bytesToHex(new Uint8Array(32).fill(5)),
      }),
    ).rejects.toThrow(/would be refused/);
  });

  it("falls back to the mnemonic", async () => {
    const r = await pqcKeypairFromEnv(clientWith(legacy.publicKey), address, { QORE_MNEMONIC: mnemonic });
    expect(r?.derivation).toBe("legacy");
  });

  it("returns undefined when nothing is configured", async () => {
    expect(await pqcKeypairFromEnv(clientWith(), address, {})).toBeUndefined();
  });
});
