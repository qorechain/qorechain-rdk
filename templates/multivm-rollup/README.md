# multivm-rollup

A QoreChain **multi-VM** rollup starter: an **EVM** rollup that calls into
**QoreChain Native** contracts through QoreChain's cross-VM precompile, built on
[`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).

Use this template when your app runs Solidity on the rollup but needs to invoke
existing QoreChain Native (Wasm) contracts on the network — for example reusing a QoreChain Native (Wasm)
oracle, token, or registry from EVM code.

## Multi-VM at a glance

- Execution VM: **EVM** (Solidity).
- Cross-VM bridge: the **EVM→QoreChain Native** precompile at
  `0x0000000000000000000000000000000000000901`, called as
  `executeCrossVMCall(uint8 targetVM, string targetContract, bytes payload)`
  with `targetVM = 1` for QoreChain Native.
- `src/crossvm-call.ts` checks whether the precompile is live, then encodes the
  calldata with the RDK's `encodeCrossVmCalldata`; `contracts/CrossVmCaller.sol`
  is the equivalent on-chain call. (EVM↔QoreChain Native only — SVM is separate.)

> **Status: the precompile is not active on mainnet or testnet today.** It is
> compiled into the validators' build but runs only once governance lists its
> address in the EVM parameter `active_static_precompiles` — empty on both
> networks — and, from chain v3.2.3, reaches only targets governance has
> allowlisted in the cross-VM parameter `bridge_allowed_targets`. Activation is
> planned for an upcoming release. Check the live state any time:
>
> ```ts
> import { isCrossVmPrecompileActive } from "@qorechain/rdk";
> const status = await isCrossVmPrecompileActive("https://api.qore.host");
> ```

**Why the check matters.** While the precompile is inactive, its address has no
code, and a call to it *succeeds* with empty return data — so a `success` check
alone reports a cross-VM call that never happened. The precompile also returns
the target's **raw** reply, so an empty reply can be genuine too, and a
precompile has no bytecode whether active or not. The dependable in-contract
guard is therefore a target that always returns a non-empty acknowledgement:
`CrossVmCaller.sol` requires one, which turns an inactive precompile into a
revert instead of a silent no-op.

**EVM authorisation windows (chain v3.2.3).** If your EVM transactions run
under a scoped authorisation window, `native_only: true` refuses any calldata —
a cross-VM call included — and a non-empty `allowed_targets` must list the
precompile's address.

Run the cross-VM check and encoder:

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
- `vmType` — `evm` | `native` | `svm` | `custom`
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
