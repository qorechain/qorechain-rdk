# custom-rollup

A QoreChain custom rollup starter: **fully overridable** — defaults to
**optimistic settlement / dedicated sequencer / native DA / standard gas / EVM**,
built on [`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).

Use this template when none of the named profiles (defi, gaming, nft, enterprise)
fit and you want to assemble a configuration field by field.

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
pnpm submit-batch    # submit a batch with a fraud proof
```

## Operate

```sh
pnpm doctor          # preflight: endpoints, network, config, signer, balance
pnpm status          # rollup health: status, latest batch, challenge window
```

`pnpm doctor` is a good first run — it verifies your `.env` is ready before you
`pnpm create`. The standalone operator CLI `npx @qorechain/rdk-cli` (`qorollup`)
does the same checks plus `watch`, `pause`, `resume`, and `stop` for a live rollup.

## Configuring the rollup

`rollup.config.ts` uses `presets.custom({ rollupId }).set({ ... })` and documents
every overridable field inline:

- `settlement` — `optimistic` | `zk` | `based` | `sovereign`
- `sequencer` — `dedicated` | `shared` | `based`
- `da` — `native` | `celestia` | `both` (celestia is planned / not yet active)
- `proofSystem` — `fraud` | `snark` | `stark` | `none`
- `gasModel` — `standard` | `eip1559` | `flat` | `subsidized`
- `vmType` — `evm` | `cosmwasm` | `svm` | `custom`
- `blockTimeMs` — target block time in milliseconds
- `maxTxPerBlock` — maximum transactions per rollup block

## The compatibility matrix

`.validate()` (run in `src/create.ts` before submitting) enforces the settlement
→ proof-system matrix. Choose a `settlement` and a matching `proofSystem`:

| settlement   | allowed proofSystem | extra constraint              |
| ------------ | ------------------- | ----------------------------- |
| `optimistic` | `fraud`             | —                             |
| `zk`         | `snark` \| `stark`  | —                             |
| `based`      | `none`              | requires the based sequencer  |
| `sovereign`  | `none`              | —                             |

A mismatch throws a `RollupConfigError` describing exactly what to fix. The
default config (optimistic + fraud) submits batches with a fraud proof; if you
switch to `based`/`sovereign`, drop the proof in `src/submit-batch.ts`, and for
`zk` supply a SNARK/STARK proof instead.

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
