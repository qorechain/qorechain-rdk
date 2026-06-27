# multivm-rollup

A QoreChain **multi-VM** rollup starter: an **EVM** rollup that calls into
**CosmWasm** contracts through QoreChain's cross-VM precompile, built on
[`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).

Use this template when your app runs Solidity on the rollup but needs to invoke
existing CosmWasm contracts on the network — for example reusing a CosmWasm
oracle, token, or registry from EVM code.

## Multi-VM at a glance

- Execution VM: **EVM** (Solidity).
- Cross-VM bridge: the **EVM→CosmWasm** precompile at
  `0x0000000000000000000000000000000000000901`.
- `src/crossvm-call.ts` encodes the precompile calldata with the RDK's
  `encodeCrossVmCalldata` helper; `contracts/CrossVmCaller.sol` shows the
  equivalent on-chain Solidity call. (EVM↔CosmWasm only — SVM is separate.)
- Confirm the precompile's exact ABI signature against your node before relying
  on the derived 4-byte selector.

Run the cross-VM encoder:

```sh
npm run crossvm-call
```

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
pnpm submit-batch    # assemble a native DA blob + fraud proof and submit a batch
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

`src/signer.ts` uses a standard secp256k1 signer. For hybrid post-quantum signing,
swap in [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s signer —
the RDK accepts any `@cosmjs` `OfflineSigner`.
