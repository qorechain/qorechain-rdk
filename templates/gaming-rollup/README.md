# gaming-rollup

A QoreChain gaming rollup starter: **based settlement / based sequencer /
native DA / flat gas / custom VM**, built on
[`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).

Tuned for high throughput: up to **50,000 tx/block**, **200ms blocks**, and
**based sequencing** (host-chain proposers include batches directly, so there is
no dedicated sequencer to run and no separate proving step).

## Prerequisites

- Node.js >= 20.
- A funded operator account on your target network (creating a rollup requires a
  stake and burns a small percentage on creation — the `create` script prints the
  live amounts before submitting).
- Node endpoint URLs.

## Setup

```sh
pnpm install        # or npm install / yarn
cp .env.example .env
```

Edit `.env`: set `QORE_NETWORK`, the `QORE_*_URL` endpoints, and your operator key
(`QORE_OPERATOR_PRIVATE_KEY_HEX` or `QORE_MNEMONIC`). Never commit `.env`.

## Scripts

```sh
pnpm create          # validate the config, show the cost, and create the rollup
pnpm query-status    # read the rollup config and its latest settlement batch
pnpm submit-batch    # assemble a native DA blob and submit a batch (no proof)
```

## Based settlement — no proof system

The gaming profile settles via the **based** paradigm, whose proof system is
`none`. Host-chain proposers include the rollup's batches directly, so a
settlement batch is submitted **without** a `proof` field — there is no
SNARK/STARK or fraud proof to generate. `src/submit-batch.ts` shows the flow:
build the native DA blob, then `tx.submitBatch(...)` with the batch roots and
`dataHash` only.

The compatibility matrix (enforced on `.validate()` / `.build()`) requires based
settlement to use the `none` proof system and the based sequencer mode.

## Quantum-safe signing

`src/signer.ts` uses a standard secp256k1 signer. For hybrid post-quantum signing,
swap in [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s signer —
the RDK accepts any `@cosmjs` `OfflineSigner`.
