# QoreChain RDK — Java client

A Java (JVM) client for the QoreChain Rollup Development Kit. It mirrors the TypeScript, Go, and Rust
clients: rollup configuration and presets, the settlement → proof compatibility matrix, denomination
and creation-cost economics, binary-Merkle withdrawal-proof assembly, REST and `qor_` JSON-RPC reads,
native account derivation, and full transaction signing and broadcast for the `rdk` module.

**Status:** Available.

## Requirements

- Java 21 or newer (the QoreChain Java SDK this client builds hybrid transactions with targets
  Java 21).

## Maven coordinates

```xml
<dependency>
  <groupId>io.github.qorechain</groupId>
  <artifactId>qorechain-rdk</artifactId>
  <version>0.8.0</version>
</dependency>
```

Gradle:

```groovy
implementation 'io.github.qorechain:qorechain-rdk:0.8.0'
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
- `accounts` — mnemonic → BIP-44 (`m/44'/118'/0'/0/0`) → secp256k1 → bech32 `qor` address derivation,
  and post-quantum key resolution (`resolvePqcKeypair`, `pqcKeypairFromEnv`).
- `tx` — hand-encoded `rdk` messages and the Cosmos transaction envelope, hybrid (post-quantum)
  signing through the QoreChain Java SDK, `RdkTxClient` (with lifecycle guards), `MockTxClient`, and
  gas simulation.

## Broadcasting

Offline signing works without a node. Read paths and settlement-receipt verification need one.
**Live broadcast requires a running QoreChain node**: point `RdkClient` / `RestClient` at the
node's REST (LCD) endpoint, supply the signer sequence and account number from the chain's auth
query, and call `RdkTxClient.broadcast`.

## Hybrid (post-quantum) signing

Both QoreChain networks require the hybrid signature (ML-DSA-87 + secp256k1) on native-lane
transactions. `RdkTxClient` signs hybrid whenever it is given a PQC keypair: every transaction is
built by the QoreChain Java SDK's `HybridTx.buildHybridTx` (`io.github.qorechain:qorechain-sdk`),
with the same messages, fee, memo, chain id, account number and sequence as before, and the
ML-DSA-87 half attached as a tx-body extension. **Without a PQC keypair the client signs
classical-only (SIGN_MODE_DIRECT, secp256k1), and the networks refuse the transaction**; that path
remains for local devnets and offline use.

```java
RdkClient rdk = new RdkClient(options);
Account account = Accounts.deriveNativeAccount(mnemonic);

// The post-quantum key this account uses, checked against the chain: the canonical
// (address-bound) or the legacy derivation of the mnemonic, whichever is registered.
// With no key registered yet it is the canonical one, embedded so the first
// transaction registers it.
Accounts.ResolvedPqcKeypair pqc = Accounts.resolvePqcKeypair(rdk, account.address, mnemonic);

RdkTxClient tx =
        new RdkTxClient(account, "qorechain-vladi", rdk.rest, HybridSigningOptions.from(pqc));
tx.broadcast(List.<Msg>of(tx.pauseRollup("my-rollup", "maintenance", null)), params);
```

From the environment (the signer from `QORE_OPERATOR_PRIVATE_KEY_HEX` or `QORE_MNEMONIC`, the PQC
key from `QORE_PQC_SEED_HEX`, a 32-byte ML-DSA-87 seed, or else `QORE_MNEMONIC`):

```java
Account account = Accounts.signerFromEnv(System.getenv(), "").account;
Accounts.ResolvedPqcKeypair pqc = Accounts.pqcKeypairFromEnv(rdk, account.address);
if (pqc == null) {
    throw new IllegalStateException("set QORE_PQC_SEED_HEX or QORE_MNEMONIC to sign hybrid");
}
RdkTxClient tx =
        new RdkTxClient(account, "qorechain-vladi", rdk.rest, HybridSigningOptions.from(pqc));
```

Resolution refuses, rather than guesses, when the account's registered key is neither derivation
of the mnemonic, or does not match `QORE_PQC_SEED_HEX`: a hybrid signature from the wrong key is
always rejected.

The hybrid sign-bytes form (v1 or v2) is chosen automatically by the SDK's resolver, which asks the
network over the client's REST endpoint which upgrade it has applied. To force one, use
`HybridSigningOptions.from(pqc).signBytesVersion(SignBytes.Mode.V2)` (or `V1`). `tx.signHybrid(...)`
builds and signs without broadcasting and returns the SDK's result, including the exact bytes the
ML-DSA-87 signature covers.

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
