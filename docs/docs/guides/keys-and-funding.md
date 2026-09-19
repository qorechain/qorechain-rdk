---
id: keys-and-funding
title: Keys & funding
sidebar_position: 10
---

# Keys & funding

Every operation that broadcasts a transaction — creating a rollup, submitting a
batch, managing lifecycle, executing a withdrawal — needs a **signer** and a
**funded account**. This guide covers generating keys, where the kit looks for
them, quantum-safe signing, and funding an account on testnet.

## Generate a key

The CLI generates a mnemonic and its derived `qor1…` address in one step:

```bash
qorollup keygen
```

> The mnemonic is printed once. **Store it securely and offline — anyone with it
> controls the account.**

In code, use `generateMnemonic` and `deriveNativeAccount`:

```ts
import { generateMnemonic, deriveNativeAccount } from "@qorechain/rdk";

const mnemonic = generateMnemonic();
const account = await deriveNativeAccount(mnemonic);
console.log(account.address);    // qor1...
// account.privateKey is the raw key bytes for building a signer.
```

You can validate an existing mnemonic with `validateMnemonic`.

## Where keys come from

The kit reads signing material from the environment, preferring a raw hex key
over a mnemonic:

| Variable | Meaning |
| --- | --- |
| `QORE_OPERATOR_PRIVATE_KEY_HEX` | Raw private key, hex (with or without `0x`). Takes priority. |
| `QORE_MNEMONIC` | BIP-39 mnemonic. Used when no hex key is set. |

`signerFromEnv` builds an `OfflineSigner` from these, returning `undefined` when
neither is set (so callers can show a friendly message rather than crash):

```ts
import { signerFromEnv } from "@qorechain/rdk";

const signer = await signerFromEnv(); // reads process.env by default
if (!signer) throw new Error("set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC");

const tx = await rdk.connectTx(signer, { gasPrice: "0.15uqor" });
```

> The chain enforces a minimum gas price (fee floor) of **0.1uqor per gas unit**
> on both mainnet and testnet. Transactions priced below the floor are rejected
> at the mempool; `0.15uqor` is a comfortable default.

The `qorollup` CLI uses the same precedence and also accepts `--key` and
`--mnemonic` flags, which override the environment.

## Build a signer directly

If you already hold a key, build the signer yourself. The RDK accepts any
`@cosmjs` `OfflineSigner`.

```ts
import { directSignerFromPrivateKey, deriveNativeAccount } from "@qorechain/rdk";

// From a derived account:
const account = await deriveNativeAccount(process.env.QORE_MNEMONIC!);
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
```

## Signing on a PQC-required network

QoreChain's native lane requires a **hybrid** signature — ML-DSA-87 (Dilithium-5)
alongside the classical secp256k1 one — on both `qorechain-vladi` (mainnet) and
`qorechain-diana` (testnet). A plain `OfflineSigner` produces only the classical
half, so a classical-only transaction is rejected on those networks.

Pass a `pqcKeypair` on connect and the tx client signs hybrid for every
transaction it sends — nothing else in your code changes, and the tx methods keep
returning the same response shape:

```ts
import { createRdkClient, signerFromEnv, generatePqcKeypair } from "@qorechain/rdk";

const rdk = createRdkClient({ network: "testnet" });
const signer = await signerFromEnv();
if (!signer) throw new Error("set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC");

const tx = await rdk.connectTx(signer, {
  gasPrice: "0.15uqor",
  pqcKeypair: myPqcKeypair, // switches the client to hybrid signing
});

await tx.createRollup({ /* … */ });
```

A few things to know:

- **The signer must be a direct signer.** Hybrid signing uses SIGN_MODE_DIRECT;
  an amino-only signer cannot carry the signature extension and is rejected with
  an explicit error. `directSignerFromPrivateKey` and `signerFromEnv` both give
  you a direct signer.
- **The PQC key must already be registered on chain** (`MsgRegisterPQCKey`) for
  your operator account. If it is not, set `includePqcPublicKey: true` so the key
  travels with the transaction and the chain can register it on first use.
- **`rest` is filled in for you.** The sign-bytes form is resolved from the
  network (`signBytesVersion: "auto"`, the default), which needs the REST/LCD
  endpoint; `rdk.connectTx` passes the network preset's REST endpoint
  automatically. Using `RdkTxClient.connect` directly, pass `rest` yourself.
- **Override the form when `"auto"` cannot resolve it.** `"auto"` looks the
  network's upgrade state up over REST; on a network whose upgrade plan is named
  differently from what it looks for, force the form with
  `signBytesVersion: "v1"` or `"v2"` instead. `resolveSignBytesVersion` and
  `isHybridSignBytesRejection` are re-exported if you want to inspect or handle
  this yourself.
- **Fees must be explicit.** The hybrid builder needs a concrete `StdFee`, so
  either pass `fee` per transaction or set `gasPrice` on connect (a gas limit is
  priced with it, and `"auto"` simulates first). Without either, the client
  throws instead of guessing.

> **Only the TypeScript client signs hybrid.** The Python, Go, Rust, and Java
> clients sign classical-only and are unsuitable for native-lane transactions on
> mainnet or `qorechain-diana`; use them on permissive networks, or pair them
> with the [`qorechain-pqc`](https://github.com/qorechain/qorechain-pqc) bindings.

The kit also re-exports `HybridSigner`, `PqcSigner`, `generatePqcKeypair`,
`pqcSign`, and `pqcVerify` for lower-level post-quantum use. The kit exposes
exactly the primitives the SDK and chain implement — nothing more.

## Unified keys & Phantom

QoreChain supports a **unified account**: one key controls all three address
forms — `qor1…` (QoreChain Native), `0x…` (EVM), and the SVM address — as a
single identity, and that same key can sign on every lane (one balance across
them). Wallets such as **Phantom** can derive and hold this unified key.

The RDK is agnostic to how your signer was produced: it signs operator
transactions with **any `@cosmjs` `OfflineSigner`**, so a unified eth-native key
(or a Phantom-derived one) works exactly like a classic `qor`-derived signer —
the operator address is simply whatever your signer presents, with no RDK
configuration changes.

Generating and managing the unified wallet itself is the job of
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) and
[`@qorechain/wallet-adapter`](https://www.npmjs.com/package/@qorechain/wallet-adapter)
— the wallet adapter derives all three addresses from one key
(`generateQoreWallet`, `walletFromMnemonic`) and supports the Phantom flow via
`walletFromSeed` (`shake256(phantomSignature)` → qor1/0x/svm). Build the signer
there, then hand it to the RDK's tx client.

## Funding an account

Creating a rollup commits a stake and burns a small percentage on creation, so
the operator account must hold at least the live `minStakeForRollup` plus fees.
Check readiness with `qorollup doctor` (the balance check) before you spend.

### Testnet faucet

The network **does not publish a fixed faucet endpoint**, so the faucet helper
posts to a URL you supply. Set `QORE_FAUCET_URL` (or pass `--faucet-url`):

```bash
export QORE_FAUCET_URL=https://faucet.testnet.example
qorollup faucet qor1youraddress...
```

In code:

```ts
import { requestFaucet } from "@qorechain/rdk";

const result = await requestFaucet({
  url: process.env.QORE_FAUCET_URL,
  address: "qor1youraddress...",
  denom: "uqor", // default
});
console.log(result.ok, result.status);
```

If no URL is configured, `requestFaucet` throws a clear message rather than
guessing an endpoint. When you do not have a faucet, fund the address by transfer
from another funded account instead.

### Mainnet

There is no faucet on mainnet — fund the operator account from an exchange or
another account you control. Preview the exact stake and burn with
`estimateCreationCost` against the live params; see [Stake & burn](stake-and-burn.md).

## Next

- [Zero to a live rollup](zero-to-rollup.md) — the end-to-end flow.
- [Stake & burn](stake-and-burn.md) — read the live creation cost.
- [Withdrawals](withdrawals.md) — the submitter signs the execute message.
