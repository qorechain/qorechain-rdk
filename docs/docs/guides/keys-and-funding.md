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

## Quantum-safe (hybrid) signing

QoreChain is a quantum-safe Layer 1, and the RDK re-exports the hybrid
post-quantum signer from [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)
so operator transactions can be signed with post-quantum protection. Because the
RDK accepts any `OfflineSigner`, you swap it in wherever a standard signer goes —
no other code changes.

```ts
import { HybridSigner } from "@qorechain/rdk";

// Construct a hybrid signer per the @qorechain/sdk docs, then:
const tx = await rdk.connectTx(hybridSigner, { gasPrice: "0.15uqor" });
```

The kit also re-exports `PqcSigner`, `generatePqcKeypair`, `pqcSign`, and
`pqcVerify` for lower-level post-quantum use. The kit exposes exactly the
primitives the SDK and chain implement — nothing more.

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
