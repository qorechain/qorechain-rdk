# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
