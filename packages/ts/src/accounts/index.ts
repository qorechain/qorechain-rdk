/**
 * Account and signing helpers, built on [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk).
 *
 * The RDK signs `rdk` transactions with any `@cosmjs` `OfflineSigner`. These
 * helpers cover the common cases — generate a mnemonic, derive an operator
 * account, and build a signer from the environment — and re-export the SDK's
 * post-quantum (hybrid) signer for quantum-safe signing.
 */
import type { OfflineSigner } from "@cosmjs/proto-signing";
import {
  deriveNativeAccount,
  derivePqcCanonical,
  derivePqcLegacy,
  directSignerFromPrivateKey,
  generateMnemonic,
  validateMnemonic,
  HybridSigner,
  PqcSigner,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  type PqcKeypair,
} from "@qorechain/sdk";
import type { RdkClient } from "../client/rdk-client";
import { ACCOUNT_PREFIX } from "../constants";
import { bytesToHex, hexToBytes } from "../utils/bytes";

// Curated re-exports (names chosen to not collide with the RDK's own surface).
export {
  generateMnemonic,
  validateMnemonic,
  deriveNativeAccount,
  directSignerFromPrivateKey,
  HybridSigner,
  PqcSigner,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  type PqcKeypair,
};

/**
 * Build an offline signer from the environment, preferring a hex private key
 * (`QORE_OPERATOR_PRIVATE_KEY_HEX`) over a mnemonic (`QORE_MNEMONIC`). Returns
 * `undefined` when neither is set, so callers can give a friendly message.
 *
 * For quantum-safe (hybrid) signing, pair this signer with a PQC keypair from
 * {@link pqcKeypairFromEnv} and pass it as `pqcKeypair` to `connectTx`. (A
 * `HybridSigner` is not a cosmjs signer and cannot be passed to `connectTx`;
 * earlier releases said otherwise.)
 */
export async function signerFromEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
  prefix: string = ACCOUNT_PREFIX,
): Promise<OfflineSigner | undefined> {
  const hex = env.QORE_OPERATOR_PRIVATE_KEY_HEX;
  const mnemonic = env.QORE_MNEMONIC;
  if (hex && hex.trim() !== "") {
    return directSignerFromPrivateKey(hexToBytes(hex.trim()), prefix);
  }
  if (mnemonic && mnemonic.trim() !== "") {
    const account = await deriveNativeAccount(mnemonic.trim());
    return directSignerFromPrivateKey(account.privateKey, prefix);
  }
  return undefined;
}

/** Which derivation produced an operator's post-quantum key. */
export type PqcDerivation = "canonical" | "legacy" | "seed";

/** The outcome of {@link resolvePqcKeypair}. */
export interface ResolvedPqcKeypair {
  keypair: PqcKeypair;
  derivation: PqcDerivation;
  /** The chain already holds this key for the account. */
  registered: boolean;
  /**
   * Pass this as `includePqcPublicKey` to `connectTx`: true when the account
   * has no key on chain yet, so the first hybrid transaction registers it.
   */
  includePqcPublicKey: boolean;
}

/**
 * Find the ML-DSA-87 keypair an account actually uses, by asking the chain.
 *
 * A mnemonic can yield two post-quantum keys, and a wallet may have registered
 * either: the **canonical** one (address-bound —
 * `shake256("qorechain:pqc:v1|" + account + "|" + mnemonic)`, what unified
 * accounts use) or the **legacy** one (the older chain-bridge scheme). Signing
 * with the wrong one is not a soft failure: the hybrid signature would not
 * match the registered key and every transaction would be refused. So this
 * derives both and returns whichever the chain has registered.
 *
 * - If the account has **no** key registered, it returns the canonical key
 *   with `includePqcPublicKey: true`, so the first transaction registers it.
 * - If the account has a key that **neither** derivation produces, it throws:
 *   the key was registered from another secret, and guessing would only cost a
 *   refused transaction. Supply that keypair explicitly instead.
 */
export async function resolvePqcKeypair(
  client: RdkClient,
  address: string,
  mnemonic: string,
): Promise<ResolvedPqcKeypair> {
  const canonical = derivePqcCanonical(address, mnemonic);
  const legacy = derivePqcLegacy(mnemonic);
  const registeredKey = await registeredPqcKey(client, address);

  if (registeredKey === "") {
    return { keypair: canonical, derivation: "canonical", registered: false, includePqcPublicKey: true };
  }
  if (registeredKey === bytesToHex(canonical.publicKey).toLowerCase()) {
    return { keypair: canonical, derivation: "canonical", registered: true, includePqcPublicKey: false };
  }
  if (registeredKey === bytesToHex(legacy.publicKey).toLowerCase()) {
    return { keypair: legacy, derivation: "legacy", registered: true, includePqcPublicKey: false };
  }
  throw new Error(
    `account ${address} has a post-quantum key on chain that neither the canonical nor the legacy ` +
      "derivation of this mnemonic produces, so it was registered from another secret. Supply that " +
      "keypair explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this account.",
  );
}

async function registeredPqcKey(client: RdkClient, address: string): Promise<string> {
  try {
    return (await client.rest.getPqcAccount(address)).publicKey.toLowerCase();
  } catch {
    // An account with no record reads as "not registered".
    return "";
  }
}

/**
 * The operator's ML-DSA-87 keypair from the environment, checked against the
 * chain, or `undefined` when no source is configured (the caller then signs
 * classical-only, which both public networks refuse on the native lane).
 *
 * - `QORE_MNEMONIC` — resolved with {@link resolvePqcKeypair}: whichever of
 *   the canonical and legacy derivations the chain has registered.
 * - `QORE_PQC_SEED_HEX` — a 32-byte ML-DSA-87 seed, for an operator who signs
 *   with a raw private key (`QORE_OPERATOR_PRIVATE_KEY_HEX`) and so has no
 *   mnemonic to derive from. Takes precedence when set. Still checked against
 *   the chain, and refused if the account holds a different key.
 */
export async function pqcKeypairFromEnv(
  client: RdkClient,
  address: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): Promise<ResolvedPqcKeypair | undefined> {
  const seedHex = env.QORE_PQC_SEED_HEX?.trim();
  if (seedHex) {
    const seed = hexToBytes(seedHex);
    if (seed.length !== 32) throw new Error(`QORE_PQC_SEED_HEX must be 32 bytes, got ${seed.length}`);
    const keypair = generatePqcKeypair(seed);
    const registeredKey = await registeredPqcKey(client, address);
    if (registeredKey === "") {
      return { keypair, derivation: "seed", registered: false, includePqcPublicKey: true };
    }
    if (registeredKey === bytesToHex(keypair.publicKey).toLowerCase()) {
      return { keypair, derivation: "seed", registered: true, includePqcPublicKey: false };
    }
    throw new Error(
      `QORE_PQC_SEED_HEX does not produce the post-quantum key registered for ${address}; ` +
        "every hybrid transaction signed with it would be refused",
    );
  }
  const mnemonic = env.QORE_MNEMONIC?.trim();
  if (mnemonic) return resolvePqcKeypair(client, address, mnemonic);
  return undefined;
}
