import {
  pqcKeypairFromEnv,
  signerFromEnv,
  type RdkClient,
  type RdkTxClient,
} from "@qorechain/rdk";
import type { OfflineSigner } from "@cosmjs/proto-signing";
import { GAS_PRICE } from "./client.js";

/** Build an offline signer from QORE_MNEMONIC or QORE_OPERATOR_PRIVATE_KEY_HEX. */
export async function getSigner(): Promise<OfflineSigner> {
  const signer = await signerFromEnv();
  if (!signer) throw new Error("No signing key. Set QORE_MNEMONIC or QORE_OPERATOR_PRIVATE_KEY_HEX in .env.");
  return signer;
}

/**
 * Connect a transaction client that signs **hybrid** (post-quantum).
 *
 * Both public networks require an ML-DSA-87 signature alongside the classical
 * one on native-lane transactions, so a classical-only client is refused. The
 * post-quantum key is resolved against the chain: from `QORE_MNEMONIC` the RDK
 * derives both the canonical and the legacy key and uses whichever your account
 * has registered (an account with none registers the canonical key on its first
 * transaction). If you sign with `QORE_OPERATOR_PRIVATE_KEY_HEX` instead, set
 * `QORE_PQC_SEED_HEX` to your 32-byte ML-DSA-87 seed.
 */
export async function connectOperator(client: RdkClient): Promise<RdkTxClient> {
  const signer = await getSigner();
  const [account] = await signer.getAccounts();
  const pqc = await pqcKeypairFromEnv(client, account.address);
  if (!pqc) {
    console.warn(
      "No post-quantum key configured, so this client signs classical-only — which mainnet and " +
        "testnet refuse on the native lane. Set QORE_MNEMONIC, or QORE_PQC_SEED_HEX alongside " +
        "QORE_OPERATOR_PRIVATE_KEY_HEX.",
    );
    return client.connectTx(signer, { gasPrice: GAS_PRICE });
  }
  if (!pqc.registered) {
    console.log(`Registering your post-quantum key (${pqc.derivation}) with this transaction.`);
  }
  return client.connectTx(signer, {
    gasPrice: GAS_PRICE,
    pqcKeypair: pqc.keypair,
    includePqcPublicKey: pqc.includePqcPublicKey,
  });
}
