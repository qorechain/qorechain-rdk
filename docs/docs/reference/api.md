---
id: api
title: API reference
sidebar_position: 3
---

# API reference

The full TypeScript API reference is generated from the source with
[TypeDoc](https://typedoc.org). Generate it locally:

```bash
cd docs
npm run docs:api
```

This reads `docs/typedoc.json` (which points at
`../packages/ts/src/index.ts`) and writes the HTML reference into
`docs/docs/api`. The generated output is not committed; run the command to
produce it.

## Main exports

`@qorechain/rdk` exposes a deliberate, supported surface. The highlights:

### Client

- **`createRdkClient(options?)`** — build an `RdkClient` for a network with
  optional endpoint overrides. Defaults to testnet.
- **`RdkClient`** — the facade. Key members:
  - `rest` — REST read client (`getRollup`, `getBlob`, batches, …).
  - `params()` — read the live `rdk` module parameters.
  - `suggestProfile(useCase, opts?)` — QCAI-assisted profile suggestion.
  - `connectTx(signer, opts?)` — connect a signing `RdkTxClient`.

### Configuration

- **`presets`** / **`PRESET_DEFAULTS`** — the five preset profiles
  (`defi`, `gaming`, `nft`, `enterprise`, `custom`).
- **`RollupConfigBuilder`** — fluent builder (`set`, `validate`,
  `validationResult`, `build`, `toCreateMsg`).
- **Enums and types** — `SettlementParadigm`, `SequencerMode`, `ProofSystem`,
  `DABackend`, `GasModel`, `VmType`, `RollupStatus`, `BatchStatus`,
  `ProfileName`, plus the runtime value arrays.
- **Compatibility matrix** and **validation** helpers.
- **`RollupConfigError`** — thrown on invalid configurations.

### Transactions

- **`RdkTxClient`** — signing client: `createRollup`, `submitBatch`,
  `challengeBatch`, `resolveChallenge`, `pauseRollup`, `resumeRollup`,
  `stopRollup`, `executeWithdrawal`.
- **Message builders** — `createRollupMsg`, `submitBatchMsg`, and the rest of
  the `rdk` message set.
- **`RDK_TYPES`** / **`createRdkRegistry`** — the rdk type registry.

### Data availability

- **`buildDaBlob(opts)`** — assemble a native DA blob and compute its
  `dataHash`, enforcing the maximum blob size.
- **`assertDaBackendAvailable(backend)`** — guard against not-yet-active
  backends (Celestia / both).

### Lifecycle

- **`canPerformRollupAction`**, **`assertRollupAction`** — rollup transitions.
- **`isBatchFinal`**, **`challengeWindowDeadline`**, **`isChallengeWindowClosed`**
  — batch and challenge-window math.

### Utilities

- **Denom** — `qorToUqor`, `uqorToQor` (QOR ↔ base `uqor`, 10^6).
- **Economics** — `estimateCreationCost` and the `CreationCost` shape.
- **Encoding** — bech32 and byte helpers.

### Profile suggestion

- **`suggestProfile(useCase, qor, opts?)`** / **`ProfileSuggestion`** — the
  standalone QCAI-assisted advisory used by `RdkClient.suggestProfile`.

For exact signatures, parameters, and return types, generate and browse the
TypeDoc output.
