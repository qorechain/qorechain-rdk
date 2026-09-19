# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.5.0

### Added

- **`qorollup receipt verify <file>` — verify a receipt somebody handed you.**
  The existing `--verify` flag only ever checked a receipt the same command had
  just built from chain, so the relying party the feature exists for — an
  auditor, an exchange, a counterparty handed a receipt file — had no way to
  check one at all. The new subcommand reads a receipt (file or stdin), verifies
  exactly what was presented without rebuilding it, and reports each check
  individually so a failure says *which* claim did not hold. Exit code is `0`
  only for a genuine receipt, so it works as a CI gate. A malformed or truncated
  file is reported as such, naming the missing fields, so "this file is broken"
  is distinguishable from "this receipt is a lie".
- **Real hybrid (post-quantum) transaction signing in the TypeScript tx client.**
  Passing `pqcKeypair` to `RdkClient.connectTx` / `RdkTxClient.connect` makes the
  client sign and broadcast every transaction through `@qorechain/sdk`'s
  `signAndBroadcastHybrid`, so the ML-DSA-87 half travels as the transaction-body
  extension the chain requires alongside the classical secp256k1 signature.

  This corrects a documented claim that was false. The tx client signed through
  cosmjs's `SigningStargateClient`, which cannot build such a transaction, so the
  RDK's transaction path was **classical-only in every language** — including
  TypeScript, which the README said supported hybrid signing — while mainnet
  (`qorechain-vladi`) and testnet (`qorechain-diana`, since chain v3.1.98) both
  require the hybrid signature on native-lane transactions.

  New `RdkTxClientConnectOptions` fields, all optional and additive (the
  classical path is byte-for-byte unchanged when `pqcKeypair` is absent):

  | Option | Meaning |
  | --- | --- |
  | `pqcKeypair` | ML-DSA-87 keypair. Present ⇒ the client signs hybrid. |
  | `rest` | REST/LCD base URL used by `signBytesVersion: "auto"`. |
  | `signBytesVersion` | `"auto"` (default), or `"v1"` / `"v2"` to force a form. |
  | `includePqcPublicKey` | Embed the PQC public key so the chain can register it on first use. |

  `RdkClient.connectTx` defaults `rest` to the resolved network's REST endpoint,
  so `"auto"` works out of the box; an explicit `rest` or `signBytesVersion` from
  the caller wins. The signer must be an `OfflineDirectSigner` (SIGN_MODE_DIRECT)
  — an amino-only signer is rejected with an explicit error. Fees are resolved to
  an explicit `StdFee`: an `StdFee` passes through, a number is priced as a gas
  limit, and `"auto"` simulates and applies the 1.4 multiplier; with no gas price
  and no explicit fee the client throws rather than guess. The tx methods keep
  returning the same `DeliverTxResponse` shape, so no call site changes.

  Also re-exported from `@qorechain/sdk`: `resolveSignBytesVersion`,
  `isHybridSignBytesRejection`, and the `SignBytesVersionOption` / `PqcKeypair`
  types. New: `RdkTxClient.isHybrid`, and an options argument on
  `RdkTxClient.fromClient` for driving the hybrid path against a custom transport.

  *(TypeScript only. The Python, Go, Rust, and Java clients remain
  classical-only in this release and are unsuitable for native-lane transactions
  on mainnet or `qorechain-diana`.)*

### Security

- **Settlement-receipt verification no longer accepts fabricated receipts**
  (reported through the Break QoreChain bug bounty). `verifySettlementReceipt`
  could be made to return `valid: true` for a receipt that was entirely made up:
  - its "binding" check compared `stateRoot` with `batchStateRoot` — two fields
    of the *same caller-supplied object*, so it proved nothing; and
  - nothing was checked against the chain, so an attacker could generate their
    own ML-DSA-87 keypair, invent a state root, sign the canonical anchor
    message, and produce a receipt that verified.

  A receipt is a **claim, not evidence**. Verification now re-reads the claim
  from live chain state and reports `valid: true` only when the receipt
  reproduces what the chain holds: the rollup really belongs to that layer, the
  chain's batch carries that state root, **an anchor matching the receipt exists
  on chain**, the creator matches the chain's registered creator, and the
  Dilithium-5 signature verifies under the key the *chain* holds for them.

### Changed (breaking)

- `verifySettlementReceipt` now takes `client` for a real verification. The
  result gains `mode: "chain" | "signature-only"`, and `checks` is replaced by
  `rollupLayerBinding`, `batchStateRoot`, `anchorOnChain`, `creatorAuthority`,
  and `pqcSignature` (the old `stateRootBinding` and `hasMaterial` are gone).
- Passing only `creatorPublicKey` is now **`mode: "signature-only"` and never
  `valid`** — by design. It shows that someone signed those bytes; it cannot
  show the anchor exists. Code that relied on offline verification returning
  `valid: true` must pass a `client`.
- Documentation corrected: receipts are **not** "fully offline verifiable". The
  guides now state that chain verification is required, and that your trust
  anchor is the node you query.

Applied in all five language clients.

### Added

- **Real hybrid (post-quantum) transaction signing in the TypeScript tx client.**
  `RdkTxClient` previously signed classical-only through cosmjs, which cannot
  build a hybrid transaction at all — so RDK transactions were refused on every
  network that enforces the post-quantum signature. Pass `pqcKeypair` (and
  `rest`) on connect and the client now signs hybrid through
  `@qorechain/sdk`'s hybrid path. `signBytesVersion` defaults to `"auto"` (the
  REST endpoint from your network preset is supplied for you) and accepts an
  explicit `"v1"`/`"v2"` override for networks whose upgrade plan name differs
  from the one `"auto"` looks up. Re-exports `resolveSignBytesVersion` and
  `isHybridSignBytesRejection`.

### Changed

- **`@qorechain/sdk` bumped to `^0.8.0`** — the release that added the v1/v2
  hybrid sign-bytes resolver. The previous `^0.7.0` pin could not reach it
  (a caret on a `0.x` version is locked to that minor).
- **Scaffolded projects now get the fixed RDK.** Every
  `create-qorechain-rollup` template pinned `@qorechain/rdk` at `^0.2.0`, and a
  caret on a `0.x` version is locked to that minor — so a rollup scaffolded
  today installed **0.2.x**, the release with the broken receipt verifier, no
  matter how many versions had shipped since. All six templates now pin
  `^0.5.0`.
- **Documented what a receipt does *not* prove.** The canonical anchor message
  covers `layer_id`, `layer_height`, `state_root` and `validator_set_hash` — it
  does not name the rollup or the batch, because an anchor is a layer-level
  object. Verification binds `rollupId` and `batchIndex` through chain reads
  instead, so a receipt cannot assert a state root the chain does not hold for
  that batch. The residual case is now stated in the guide: where two batches
  genuinely share a state root on the same layer under the same creator, a
  genuine anchor signature can be relabelled between them. Closing that requires
  the anchor message to commit to the rollup and batch, which is a chain-side
  change.
- **The CLI no longer ships two stale packages.** `@qorechain/sdk` and
  `@qorechain/evm` were runtime dependencies of `@qorechain/rdk-cli` but imported
  nowhere in its source, so every install pulled them and forced a second, older
  copy of the SDK into the tree. The SDK moved to `devDependencies` at `^0.8.0`
  (only the test suite uses it), leaving one SDK version resolved.
- **Corrected a false claim in the README.** It stated that the TypeScript path
  supported hybrid signing while Python, Go, Rust and Java were classical-only.
  In fact no language signed hybrid. TypeScript now genuinely does; the other
  four remain classical-only and are not suitable for native-lane transactions
  on a network that requires the post-quantum signature.

## 0.4.4

### Changed

- **Bumped `@qorechain/sdk` to `^0.7.0`** — the SDK's "authenticator lanes"
  release (chain v3.1.85). Purely additive: a linked external key (Phantom
  ed25519 or a MetaMask secp256k1 key) can spend from the one canonical
  PQC-required account through a relayer under least-privilege, spending-limited,
  revocable terms (`MsgExecuteEVM`/`MsgExecuteCosmos`), plus same-algorithm PQC
  key rotation (`MsgRotatePQCKey`) and Phantom/MetaMask execute builders. No RDK
  API change — the new capabilities are available to TypeScript users directly
  through `@qorechain/sdk`. `@qorechain/evm` stays `^0.5.1` (the SDK 0.7.x line
  still uses it). All packages version-aligned to 0.4.4.

## 0.4.3

### Fixed

- **Hybrid-signature transaction encoding** — bumped the `@qorechain/sdk`
  dependency from `^0.5.1` to `^0.6.1`, which carries the fix for a
  consensus-critical bug: the `/qorechain.pqc.v1.PQCHybridSignature` tx-body
  extension was serialized as JSON into `Any.value` instead of protobuf, so the
  chain rejected every hybrid-signed transaction at CheckTx (the leading `0x7b`
  `{` was misread as protobuf field 15 `start_group`). With `@qorechain/sdk`
  ≥ 0.6.1 the extension is protobuf-encoded (value begins `0x08`) and hybrid
  transactions are accepted. Affects only the TypeScript hybrid-signing path
  (`HybridSigner`); the Python, Go, Rust, and Java clients sign classical-only
  and were never impacted (version-aligned to 0.4.3 only).

## 0.4.2

### Added

- **Public network endpoints in the presets.** The `mainnet` and `testnet`
  presets now ship the live `qore.host` / `*-testnet.qore.host` endpoints, so
  `createRdkClient({ network })` reaches the chain out of the box. Localhost
  defaults remain available (`LOCALHOST_ENDPOINTS`) for local nodes. (All five
  language clients.)
- **`native` VM type** — the QoreChain Native (Wasm) runtime. New helpers
  `isVmType`, `vmTypeWireValue`, and `vmTypeLabel`. (All five clients.)

### Changed

- **Rebrand to "QoreChain Native".** The Wasm rollup VM is now `native`
  throughout the docs, labels, and the `nft` preset. `cosmwasm` remains an
  accepted legacy alias, and both `native` and `cosmwasm` map to `cosmwasm` on
  the wire (the chain, explorer, and dashboard are unchanged). Multi-VM tooling
  now reads as "EVM → QoreChain Native"; the cross-VM precompile ABI
  (`executeCrossVMCall`) is unchanged.
- Documented unified-key / Phantom compatibility: a single unified key
  (qor1/0x/svm) signs RDK operator transactions like any signer (chain v3.1.83).

## 0.4.1

### Changed

- Raised all gas-price defaults and examples from `0.025uqor` to `0.15uqor`
  (the chain now enforces a fee floor of 0.1uqor per gas unit on both
  networks): `qorollup` CLI default, scaffold templates, examples, and docs.
- Docs, templates, and examples now reference the live public endpoints
  (`rpc/api/evm/svm[-testnet].qore.host`, `wss://rpc[-testnet].qore.host/websocket`)
  and the public explorer (explore.qore.network) instead of placeholder hosts.
- `@qorechain/sdk` dependency raised to `^0.5.1` (deterministic ML-DSA-87
  hybrid signing, as required by the chain).
- `qorechain-pqc` dependency ranges raised to accept the deterministic 0.1.1
  release: Python `>=0.1.1,<0.2`, Rust `0.1.1`, Go `v0.1.1`, Maven `[0.1.0,0.2)`.

### Documentation

- Added an explicit note to the Python, Go, Rust, and Java (JVM) packages:
  mainnet requires the hybrid PQC signature extension on native-lane
  transactions; those clients currently sign classical-only (SIGN_MODE_DIRECT)
  and should be used on permissive networks or paired with the `qorechain-pqc`
  bindings. The TypeScript path supports hybrid signing via `@qorechain/sdk`.

## 0.3.0

### Added

- Full **Python**, **Go**, and **Rust** clients (each v0.3.1), mirroring the
  TypeScript surface: config builder + validation, the five presets, denom /
  economics / bech32 utilities, binary-Merkle and withdrawal-proof helpers,
  rollup manifests, REST and `qor_` JSON-RPC read clients, preflight / health,
  accounts (mnemonic → secp256k1 → `qor` address), and transaction signing +
  broadcast (SIGN_MODE_DIRECT). All three are verified against shared
  cross-language golden vectors and covered by per-language CI (`ci-py`,
  `ci-go`, `ci-rust`). Live broadcast requires a node endpoint.

## 0.2.0

### Added

- `@qorechain/rdk` 0.2.0 — operator-grade helpers built on the existing surface:
  - `checkPreflight` (the `doctor` engine), `getRollupHealth`, `watchRollup`,
    and `eventsFromTxHash` for readiness checks and live monitoring.
  - Accounts via `@qorechain/sdk`: `signerFromEnv`, `generateMnemonic`,
    `deriveNativeAccount`, and the hybrid post-quantum signer.
  - `toManifest` / `fromManifest` — a portable rollup manifest.
  - Binary-Merkle utilities and `assembleWithdrawalProof` for withdrawals.
  - `MockTxClient` and `RdkTxClient.simulate` for offline flows and dry runs.
  - A configurable faucet helper and bank balance reads.
- `@qorechain/rdk-cli` (`qorollup`) — a new operator command line: `doctor`,
  `create` (+ `--dry-run`), `status`, `watch`, `params`, `suggest`,
  `pause`/`resume`/`stop`, `keygen`, `manifest`, `withdraw`, and `faucet`.
- Documentation: the `qorollup` reference, a zero-to-rollup tutorial, and
  monitoring, withdrawals, keys & funding, and local/dry-run guides.

### Changed

- Templates sign via `signerFromEnv`, depend on `@qorechain/rdk` ^0.2.0, ship
  `doctor`/`status` scripts and a CI workflow, and document the operator CLI.
  `create-qorechain-rollup` is now 0.2.0.

## create-qorechain-rollup 0.1.1

### Changed

- The `defi-rollup` template now ships checked-in Groth16 reference artifacts
  (`circuits/artifacts/`), so the reference SNARK prover generates and locally
  verifies a real proof out of the box. Rebuild them any time with
  `pnpm circuit:build` (requires the `circom` compiler).

## 0.1.0 — Initial release

### Added

- `@qorechain/rdk` (TypeScript): typed rollup configuration with the settlement →
  proof compatibility matrix and the based-sequencer constraint enforced
  client-side; the five preset profiles; the rollup and settlement-batch
  lifecycles; native data availability with the Celestia "planned" guard; REST and
  `qor_` JSON-RPC read clients; a QCAI-assisted `suggestProfile` with a documented
  `defi` fallback; and denomination, economics, and address utilities.
- `create-qorechain-rollup`: an interactive scaffolder for the five profile
  templates (defi/gaming/nft/enterprise/custom), each runnable against the public
  testnet, with a reference SNARK prover in the defi template.
- Python, Go, and Rust package scaffolds mirroring the TypeScript conceptual
  surface, marked "coming soon".
- A documentation site, a runnable examples gallery, and CI with a
  forbidden-term / secret security-scan gate.
