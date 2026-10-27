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
    `listBatches(id, { startIndex })` follows every page of the chain's paged
    `Batches` query; `listBatchesPage` reads one page; `getLatestBatch` uses the
    chain's `LatestBatch` route. `RollupView` carries `escrowBalance` and, from
    chain v3.2.4, the rollup's own `challengeWindowSec`, `challengeBond` and
    `proofSystem`; `BatchView` carries `submittedTime` from v3.2.4.
  - `params()` — read the live `rdk` module parameters.
  - `getChainTip()` — latest height and block time, from the RPC `/status`.
  - `suggestProfile(useCase, opts?)` — QCAI-assisted profile suggestion.
  - `connectTx(signer, opts?)` — connect a signing `RdkTxClient`. `opts.rest`
    defaults to the network preset's REST endpoint (used by hybrid
    `signBytesVersion: "auto"`).

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
  `stopRollup`, `executeWithdrawal`. Connect options: `gasPrice`, plus the hybrid
  (post-quantum) set — `pqcKeypair` (present ⇒ sign hybrid), `rest`,
  `signBytesVersion` (`"auto" | "v1" | "v2"`), `includePqcPublicKey`. `isHybrid`
  reports which path is in use.
- **`submitBatch(input, { anchor })`** — signs the batch's v2 anchor when this
  client is the rollup's creator and signs hybrid, so the batch is anchored and
  a receipt can exist for it. `anchor: "require"` refuses instead of submitting
  unanchored; `"off"` never signs. **`anchorSignBytesForBatch`** builds the bytes
  for a creator signing out of band.
- **`resolveSignBytesVersion`** / **`isHybridSignBytesRejection`** — re-exported
  from `@qorechain/sdk` for inspecting or handling the hybrid sign-bytes form.
- **`resolvePqcKeypair(client, address, mnemonic)`** / **`pqcKeypairFromEnv`** —
  the operator's ML-DSA-87 key, checked against the chain: derives both the
  canonical and the legacy key and returns the one the account has registered.
- **Message builders** — `createRollupMsg`, `submitBatchMsg`, and the rest of
  the `rdk` message set.
- **`RDK_TYPES`** / **`createRdkRegistry`** — the rdk type registry.

### Data availability

- **`buildDaBlob(opts)`** — assemble a blob and compute the chain's SHAKE-256 commitment to it,
  enforcing the maximum blob size. No transaction posts a blob to the chain
  today, so do **not** put this hash in a batch on a `native` or `both` rollup
  (see [Data availability](../guides/data-availability.md)).
- **`assertDaBackendAvailable(backend)`** — guard against not-yet-active
  backends (Celestia / both).

### Withdrawals

- **`withdrawalsTree(withdrawals, { rollupId, version, chainId })`** — a batch's
  withdrawals root and every proof, built exactly as the chain does (tested
  against the chain's own verifier). `version` is the batch's binding
  (`transitionRootVersionForBatch`).
- **`withdrawalLeafV1`** / **`withdrawalLeafV2`** — the chain's leaves (v2, from
  chain v3.2.5, names the chain id).
- **`assembleWithdrawalProof(leaves, index)`** — a proof from leaves you hold;
  the chain's tree by default (before 0.7.0 it re-hashed with SHA-256).
- **`buildExecuteWithdrawalInput`** — the `executeWithdrawal` input.
- **`binaryMerkleRoot`** / **`binaryMerkleProof`** / **`verifyBinaryMerkleProof`**
  — generic helpers, SHAKE-256 by default.
- **`qorehash(...parts)`** — SHAKE-256, 32 bytes: the chain's default hash.

### Lifecycle

- **`canPerformRollupAction`**, **`assertRollupAction`** — rollup transitions.
- **`batchChallengeWindow(batch, windowSecs, tip)`** — a batch's challenge window
  computed with the chain's own rules: seconds of block time for a batch with a
  recorded submission time (v3.2.4+), `windowSecs / 6` blocks from the
  submission height otherwise. Returns `{ mode, open, finalizable, … }`.
- **`isBatchFinal`**, **`challengeWindowDeadline`**, **`isChallengeWindowClosed`**
  — generic helpers. Note `challengeWindowDeadline` adds seconds to whatever
  you pass; a batch's `submittedAt` is a height, so use `batchChallengeWindow`.

### Settlement receipts

- **`buildSettlementReceipt`** / **`verifySettlementReceipt`** — portable
  receipts, verified against live chain state. Schema version 2 records
  `chainId`; the result reports `signBytesVersion` and a `chainBinding` check.
  Every receipt field is compared with the chain; the result carries the
  chain's `anchor` and, when valid, the `verifiedReceipt` rebuilt from chain
  state.
- **`receiptSchemaError`** / **`SUPPORTED_RECEIPT_VERSIONS`** — the version,
  algorithm and required-field check run before any chain read.
- **`anchorSignBytesV1`** / **`anchorSignBytesV2`** / **`anchorSignBytesVersionFor`**
  — the two canonical anchor messages and the height-based choice between them.

### Errors

- **`decodeRdkTxError(result)`** / **`RDK_ERRORS`** — `@qorechain/sdk`'s
  `decodeTxError` plus the `rdk` module's own codes (2 to 36), with what to do
  about the ones an operator meets.

### Watchtower helpers

- **`transitionRootValidator(client, rollupId)`** — a `validate` predicate for
  `watchBatches` that applies the chain's fraud rule.
- **`fraudProofForBatch(client, rollupId, batch)`** — the proof that wins a
  challenge against a batch, or `undefined` for an honest one.

### Transition roots

- **`batchTransitionRoot(input, version)`** / **`batchTransitionRootV1`** /
  **`batchTransitionRootV2`** — the canonical state root the chain judges an
  optimistic batch by. Tested against vectors from the chain's own implementation.
- **`transitionRootVersionFor(rest)`** — the binding a batch submitted now is
  judged by (`v2` once the chain reports `rdk-withdrawals-binding`).
- **`transitionRootVersionForBatch(rest, batch)`** — the binding an existing
  batch is judged by, from its own flag or the height v3.2.5 was applied at.
- **`fraudProof(prevStateRoot, correctRoot)`** — the 64-byte proof the chain's
  optimistic verifier reads.
- **`RestClient.getProtocolFeatures`** / **`isProtocolFeatureEnabled`** /
  **`getAppliedPlanHeight`** — the chain reads these rest on.

### Chain rules (checked before a fee is paid)

- **`rollupIdError`** / **`isValidRollupId`** — the v3.2.2 id grammar.
- **`withdrawalErrors`** — the v3.2.3 withdrawal checks (denom, amount, proof
  depth and sibling length, addresses).
- **`withdrawalsRootError`** — from chain v3.2.5 a batch's withdrawals root is
  empty or 32 bytes; `submitBatch` checks it.
- **`stopRollupError`** / **`MAX_PENDING_OPTIMISTIC_BATCHES`** — v3.2.5's stop
  guard (`stopRollup` checks it when it can read the chain) and the 4,096
  pending-batch limit.
- **`dataHashError`** — a batch on a `native` or `both` DA rollup must leave
  `dataHash` empty. `RdkTxClient.submitBatch` applies it when it can read the
  rollup.

### Multi-VM

- **`encodeCrossVmCalldata`**, **`CROSS_VM_PRECOMPILE`**, **`CROSS_VM_TARGET`**,
  **`CROSS_VM_DEFAULT_SIGNATURE`** — `executeCrossVMCall(uint8,string,bytes)`.
- **`isCrossVmPrecompileActive(rest)`** — whether the precompile is live on a
  network (it is not yet active on mainnet or testnet).
- **`getCrossVmParams(rest)`** / **`crossVmTargetReady(rest, contract)`** — the
  allowlist (`/qorechain/crossvm/v1/params`, chain v3.2.5) and whether a call
  to `contract` would reach it, with the blocking reason.
- **`decodeCrossVmResult(ret)`** / **`decodeRevertReason(data)`** — the
  precompile's `abi.encode(bytes)` result and its `Error(string)` refusals.

### Utilities

- **Denom** — `qorToUqor`, `uqorToQor` (QOR ↔ base `uqor`, 10^6).
- **Economics** — `estimateCreationCost` and the `CreationCost` shape.
- **Encoding** — bech32 and byte helpers.

### Profile suggestion

- **`suggestProfile(useCase, qor, opts?)`** / **`ProfileSuggestion`** — the
  standalone QCAI-assisted advisory used by `RdkClient.suggestProfile`.

For exact signatures, parameters, and return types, generate and browse the
TypeDoc output.
