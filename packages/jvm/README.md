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
  <version>0.5.0</version>
</dependency>
```

Gradle:

```groovy
implementation 'io.github.qorechain:qorechain-rdk:0.5.0'
```

## What's new in 0.5.0

- **Settlement receipts are verified against the chain (security fix).**
  `verifySettlementReceipt` now re-reads every claim from live chain state: the
  rollup's layer binding, the batch's state root, the anchor itself, and the
  creator's registered post-quantum key. The verification record gains a `mode`
  (`chain` or `signature-only`) and reports five checks — `rollupLayerBinding`,
  `batchStateRoot`, `anchorOnChain`, `creatorAuthority`, `pqcSignature`. Only
  `chain` mode can ever return `valid = true`. Supplying a public key without a
  client is `signature-only`: it proves someone signed those bytes, never that
  QoreChain anchored the batch, and is never valid. The receipt's own
  `batchStateRoot` field remains, but it is informational — verification compares
  the receipt against the chain's batch, never against that copy.

## What's new in 0.4.2

- **Public network endpoints** — the `mainnet` and `testnet` presets now ship the
  live public endpoints (`api`/`rpc`/`evm`/`grpc`[`-testnet`]`.qore.host`) so a
  client works out of the box; `Networks.localhostEndpoints()` remains available
  for local dev.
- **QoreChain Native VM type** — `VmType.NATIVE` (advertised as `native`) is the
  QoreChain Native runtime; the legacy `cosmwasm` alias is still accepted.
  `Enums.vmTypeWireValue` maps `native` to the `cosmwasm` wire value for
  `MsgCreateRollup` (the chain never sees `native`), and the `nft` preset now uses
  `native`.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `getRollupAdvice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `buildSettlementReceipt` /
  `verifySettlementReceipt`: a portable record that a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature. A receipt is a *claim, not evidence*, so verification re-reads it
  from live chain state and needs a client. The ML-DSA-87 verification uses the
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

Offline signing works without a node. Read paths and settlement-receipt verification need one.
**Live broadcast requires a running QoreChain node**: point `RdkClient` / `RestClient` at the
node's REST (LCD) endpoint, supply the signer sequence and account number from the chain's auth
query, and call `RdkTxClient.broadcast`.

> **Mainnet PQC signing requirement.** QoreChain mainnet requires the hybrid
> post-quantum signature extension (ML-DSA-87 + secp256k1) on native-lane
> transactions. The Java transaction path currently signs classical-only
> (SIGN_MODE_DIRECT, secp256k1), so native-lane broadcasts to mainnet will be
> rejected — use it on permissive networks (testnet, local devnets) or pair it
> with the [`qorechain-pqc`](https://github.com/qorechain/qorechain-pqc)
> bindings in a custom backend. The TypeScript RDK supports hybrid signing via
> [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk). Read paths,
> offline signing, and settlement-receipt verification are unaffected.

## Verifying a settlement receipt

```java
RdkClient client = new RdkClient(options);
SettlementReceipt receipt = Receipts.buildSettlementReceipt(client, "my-rollup", 7);

// Against live chain state — the only way to get valid = true.
ReceiptVerification v = Receipts.verifySettlementReceipt(receipt, client);
if (v.valid) {
    // v.mode == ReceiptVerificationMode.CHAIN
}
```

A receipt on its own proves nothing: every field in it is supplied by whoever
handed it to you. `verifySettlementReceipt` resolves the rollup's layer, the
batch's state root, the matching anchor and the creator's post-quantum key from
the chain, and only reports `valid` when the receipt reproduces all of them.

Without a client you can still check the signature against a key obtained
out-of-band, but the result is `mode = SIGNATURE_ONLY` and always `valid = false`
— a signature shows that the holder of that key signed those bytes, not that
QoreChain anchored the batch.

## Building

```sh
mvn -q clean test
```
