# QoreChain RDK — Java client

A Java (JVM) client for the QoreChain Rollup Development Kit. It mirrors the TypeScript, Go, and Rust
clients: rollup configuration and presets, the settlement → proof compatibility matrix, denomination
and creation-cost economics, binary-Merkle withdrawal-proof assembly, REST and `qor_` JSON-RPC reads,
native account derivation, and full transaction signing and broadcast for the `rdk` module.

**Status:** Available.

## Requirements

- Java 17 or newer.

## Maven coordinates

```xml
<dependency>
  <groupId>io.github.qorechain</groupId>
  <artifactId>qorechain-rdk</artifactId>
  <version>0.4.0</version>
</dependency>
```

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `getRollupAdvice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `buildSettlementReceipt` /
  `verifySettlementReceipt`: a portable receipt proving a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature, verifiable fully offline. The ML-DSA-87 verification uses the
  [`qorechain-pqc`](https://github.com/qorechain) library.

## What's included

- `config` — enums, `RollupConfig`, the settlement→proof matrix, `Validate`, `RollupConfigBuilder`,
  networks, and lifecycle guards.
- `presets` — the five documented profiles (defi, gaming, nft, enterprise, custom).
- `util` — exact `qorToUqor` / `uqorToQor` denom math, creation-cost economics, and a hand-rolled
  BIP-173 bech32 codec.
- `bridge` — binary Merkle root/proof/verify and withdrawal-proof assembly.
- `manifest` — portable JSON snapshots of a resolved configuration.
- `client` — `RestClient`, `QorClient`, the high-level `RdkClient`, plus preflight, health,
  monitoring, faucet, and event helpers. HTTP runs behind an injectable `Transport` interface.
- `accounts` — mnemonic → BIP-44 (`m/44'/118'/0'/0/0`) → secp256k1 → bech32 `qor` address derivation.
- `tx` — hand-encoded `rdk` messages and the Cosmos transaction envelope, SIGN_MODE_DIRECT signing,
  `RdkTxClient` (with lifecycle guards), `MockTxClient`, and gas simulation.

## Broadcasting

Read paths and offline signing work without a node. **Live broadcast requires a running QoreChain
node**: point `RdkClient` / `RestClient` at the node's REST (LCD) endpoint, supply the signer
sequence and account number from the chain's auth query, and call `RdkTxClient.broadcast`.

## Building

```sh
mvn -q clean test
```
