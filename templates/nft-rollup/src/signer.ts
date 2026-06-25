import { DirectSecp256k1HdWallet, DirectSecp256k1Wallet, type OfflineSigner } from "@cosmjs/proto-signing";
import { fromHex } from "@cosmjs/encoding";

const PREFIX = "qor";

/**
 * Build an offline signer from the environment: a hex private key
 * (`QORE_OPERATOR_PRIVATE_KEY_HEX`) or a mnemonic (`QORE_MNEMONIC`).
 *
 * For quantum-safe (hybrid) signing, swap this for `@qorechain/sdk`'s
 * `directSignerFromPrivateKey` / hybrid signer — the RDK accepts any
 * `@cosmjs` `OfflineSigner`.
 */
export async function getSigner(): Promise<OfflineSigner> {
  const hex = process.env.QORE_OPERATOR_PRIVATE_KEY_HEX;
  const mnemonic = process.env.QORE_MNEMONIC;
  if (hex) {
    return DirectSecp256k1Wallet.fromKey(fromHex(hex.replace(/^0x/, "")), PREFIX);
  }
  if (mnemonic) {
    return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: PREFIX });
  }
  throw new Error(
    "No signing key found. Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC in .env.",
  );
}
