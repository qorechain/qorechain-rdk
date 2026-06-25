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
  directSignerFromPrivateKey,
  generateMnemonic,
  validateMnemonic,
  HybridSigner,
  PqcSigner,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
} from "@qorechain/sdk";
import { ACCOUNT_PREFIX } from "../constants";
import { hexToBytes } from "../utils/bytes";

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
};

/**
 * Build an offline signer from the environment, preferring a hex private key
 * (`QORE_OPERATOR_PRIVATE_KEY_HEX`) over a mnemonic (`QORE_MNEMONIC`). Returns
 * `undefined` when neither is set, so callers can give a friendly message.
 *
 * For quantum-safe (hybrid) signing, build a {@link HybridSigner} instead.
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
