import { signerFromEnv } from "@qorechain/rdk";
import type { OfflineSigner } from "@cosmjs/proto-signing";

/** Build an offline signer from QORE_MNEMONIC or QORE_OPERATOR_PRIVATE_KEY_HEX.
 * For hybrid post-quantum signing, build a HybridSigner from @qorechain/sdk. */
export async function getSigner(): Promise<OfflineSigner> {
  const signer = await signerFromEnv();
  if (!signer) throw new Error("No signing key. Set QORE_MNEMONIC or QORE_OPERATOR_PRIVATE_KEY_HEX in .env.");
  return signer;
}
