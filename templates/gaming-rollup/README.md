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
pnpm submit-batch    # submit a batch (no proof)
```

## Operate

```sh
pnpm doctor          # preflight: endpoints, network, config, signer, balance
pnpm status          # rollup health: status, latest batch, challenge window
```

`pnpm doctor` is a good first run — it verifies your `.env` is ready before you
`pnpm create`. The standalone operator CLI `npx @qorechain/rdk-cli` (`qorollup`)
does the same checks plus `watch`, `pause`, `resume`, and `stop` for a live rollup.

## Based settlement — no proof system

The gaming profile settles via the **based** paradigm, whose proof system is
`none`. Host-chain proposers include the rollup's batches directly, so a
settlement batch is submitted **without** a `proof` field — there is no
SNARK/STARK or fraud proof to generate. `src/submit-batch.ts` shows the flow:
`tx.submitBatch(...)` with the batch roots only. It leaves `dataHash` empty: no
transaction posts a data-availability blob to the chain yet, so the chain
refuses a batch that claims one.

The compatibility matrix (enforced on `.validate()` / `.build()`) requires based
settlement to use the `none` proof system and the based sequencer mode.

## Quantum-safe signing

Both QoreChain networks require a **hybrid** signature on native-lane
transactions — an ML-DSA-87 (Dilithium-5) signature alongside the classical
secp256k1 one — and refuse a classical-only transaction. Every script here
connects through `connectOperator()` in `src/signer.ts`, which signs hybrid.

You do not configure the post-quantum key directly in most cases:

- **With `QORE_MNEMONIC`**, the RDK derives the key for you. A mnemonic can
  yield two post-quantum keys (canonical and legacy), and a wallet may have
  registered either; the RDK reads which one your account holds on chain and
  uses that. An account with no key yet registers the canonical one on its first
  transaction.
- **With `QORE_OPERATOR_PRIVATE_KEY_HEX`**, there is no mnemonic to derive
  from, so also set `QORE_PQC_SEED_HEX` to your 32-byte ML-DSA-87 seed.

Either way the key is checked against the chain before anything is signed: if
your account holds a different post-quantum key, the script stops with a clear
error instead of paying for a transaction that would be refused.
