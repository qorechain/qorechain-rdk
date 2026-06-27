# @qorechain/rdk

Official TypeScript Rollup Development Kit for launching and operating
application-specific rollups (app-chains) on the QoreChain network — a
quantum-safe Layer 1.

The RDK is a client/operator toolkit: it drives the on-chain `rdk` module over
public RPC / REST / gRPC / JSON-RPC. It depends on
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) for accounts,
quantum-safe signing, and transport.

> Published at v0.4.0 — `npm i @qorechain/rdk`.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `getRollupAdvice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions (best-effort; unreachable services degrade to
  warnings).
- **Quantum-safe settlement receipts** — `buildSettlementReceipt` /
  `verifySettlementReceipt`: a portable receipt proving a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature, verifiable fully offline.
- **Multi-VM tooling** — `encodeCrossVmCalldata`, `functionSelector`, and the
  `CROSS_VM_PRECOMPILE` address for EVM → CosmWasm cross-VM calls.
- **Watchtower** — `watchBatches`, an auto-challenger framework for optimistic
  rollups (you supply the validity predicate; wire `onInvalid` to a challenge).

## Install

```sh
npm install @qorechain/rdk
```

## What it does

- **Configure** a rollup with a typed, validated `RollupConfig` — settlement
  paradigm, sequencer mode, data availability backend, proof system, gas model,
  VM type, block time, and limits — with the compatibility matrix enforced
  before anything is submitted.
- **Start from a preset** (`defi`, `gaming`, `nft`, `enterprise`, `custom`) and
  override field by field, or get a QCAI-assisted suggestion from a
  plain-language description of your app.
- **Manage the lifecycle** — create, pause, resume, and stop rollups, with
  client-side state-machine guards.
- **Submit settlement batches** and assemble proof payloads for each settlement
  path (on-chain verification gates finalization).
- **Submit and query native data-availability blobs**.
- **Read** rollup and batch status, list rollups, and module parameters over
  REST, gRPC, and the `qor_` JSON-RPC namespace.

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live). The RDK defaults to testnet.
- Token: `QOR` / `uqor` (10^6 base units per QOR).

## License

Apache-2.0
