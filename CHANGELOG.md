# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
