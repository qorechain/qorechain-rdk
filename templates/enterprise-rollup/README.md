# enterprise-rollup

A QoreChain enterprise rollup starter: **based settlement / based sequencer /
native DA / subsidized gas / EVM**, built on
[`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).

Permissioned-friendly, with **subsidized gas** so end users pay ~nothing (the
operator absorbs fees), running an EVM execution layer at up to **20,000
tx/block**. Based sequencing means host-chain proposers include the rollup's
batches directly — no dedicated sequencer to run, no separate proving step.

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

## Operate

```sh
pnpm doctor          # preflight: endpoints, network, config, signer, balance
pnpm status          # rollup health: status, latest batch, challenge window
```

`pnpm doctor` is a good first run — it verifies your `.env` is ready before you
`pnpm create`. The standalone operator CLI `npx @qorechain/rdk-cli` (`qorollup`)
does the same checks plus `watch`, `pause`, `resume`, and `stop` for a live rollup.

## Based settlement — no proof system

The enterprise profile settles via the **based** paradigm, whose proof system is
`none`. Host-chain proposers include the rollup's batches directly, so a
settlement batch is submitted **without** a `proof` field — there is no
SNARK/STARK or fraud proof to generate. `src/submit-batch.ts` shows the flow:
build the native DA blob, then `tx.submitBatch(...)` with the batch roots and
`dataHash` only.

The compatibility matrix (enforced on `.validate()` / `.build()`) requires based
settlement to use the `none` proof system and the based sequencer mode.

## Subsidized gas

The `subsidized` gas model lets the operator cover execution fees so end users
pay ~nothing — useful for permissioned and consumer-facing enterprise
deployments where a smooth, gas-free UX matters.

## Quantum-safe signing

`src/signer.ts` uses a standard secp256k1 signer. For hybrid post-quantum signing,
swap in [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s signer —
the RDK accepts any `@cosmjs` `OfflineSigner`.
