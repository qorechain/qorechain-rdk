---
id: overview
title: Overview
slug: /
sidebar_position: 1
---

# QoreChain RDK

The QoreChain RDK (Rollup Development Kit) is the developer toolkit for
designing, launching, configuring, and operating application-specific rollups
(app-chains) on **QoreChain** — a quantum-safe Layer 1 network with first-class
CosmWasm, EVM/Solidity, and SVM runtimes.

The RDK is a **client and operator toolkit**. It talks to QoreChain nodes over
their public RPC / REST / gRPC / JSON-RPC surfaces and drives rollup creation,
settlement-batch submission, lifecycle management, and data-availability
queries. It is the developer-facing front door for launching rollups on the
network.

## What is an app-chain rollup on QoreChain?

A rollup is an application-specific chain that executes transactions off the
**Main Chain** and periodically anchors its state to QoreChain. You decide how
it settles, who sequences it, where its data lives, and which runtime it
exposes — then you operate it through the RDK.

Anchoring is what makes a rollup *part of* QoreChain rather than a standalone
network. Each settlement batch commits the rollup's new state root and a
commitment to its data to the Main Chain. Because that anchor lives on a
quantum-safe Layer 1, the integrity of the rollup's history inherits the same
post-quantum protection as the base chain. See
[Rollups & anchoring](concepts/rollups-and-anchoring.md) for the full model.

You configure four orthogonal dimensions per rollup:

- **Settlement paradigm** — `optimistic`, `zk`, `based`, or `sovereign`.
- **Sequencer mode** — `dedicated`, `shared`, or `based`.
- **Data availability** — `native`, `celestia` (planned), or `both`.
- **Execution VM** — `evm`, `cosmwasm`, `svm`, or `custom`.

Plus a gas model and per-rollup limits. The RDK enforces the compatibility
matrix between these dimensions before anything is submitted on-chain.

## Quantum-safe by design

The TypeScript RDK depends on [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)
for accounts, transport, and quantum-safe signing. Operator transactions —
creating a rollup, submitting a batch, managing lifecycle — can be signed with a
standard secp256k1 signer or with the SDK's hybrid post-quantum signer, since
the RDK accepts any [`@cosmjs`](https://www.npmjs.com/package/@cosmjs/proto-signing)
`OfflineSigner`. No marketing claims here — the kit exposes exactly the
primitives the chain implements.

## The RDK family

The RDK ships as a family of packages so you can build in your language of
choice. The TypeScript package is the reference and at the highest polish; the
Python, Go, Rust, and Java (JVM) clients mirror the full surface and are verified
against shared cross-language golden vectors.

| Package | Language | Status |
| --- | --- | --- |
| `@qorechain/rdk` | TypeScript | Available (v0.2.0) |
| `@qorechain/rdk-cli` (`qorollup`) | Operator CLI | Available (v0.1.0) |
| `create-qorechain-rollup` | Project scaffolding CLI | Available (v0.2.0) |
| `qorechain-rdk` | Go | Available (v0.3.1, `go get`) |
| `qorechain-rdk` | Python | Available on PyPI (v0.3.1, imports as `qorrdk`) |
| `qorechain-rdk` | Rust | Available on crates.io (v0.3.1) |
| `io.github.qorechain:qorechain-rdk` | Java (JVM) | Available on Maven Central (v0.3.1) |

The TypeScript core (`@qorechain/rdk`) is the basis for the examples in this
documentation.

## Where to go next

- [Install](install.md) — per-language install instructions.
- [Quickstart](quickstart.md) — from zero to a live testnet rollup.
- [Zero to a live rollup](guides/zero-to-rollup.md) — guided `qorollup` CLI
  walkthrough, with the library equivalent.
- [Rollups & anchoring](concepts/rollups-and-anchoring.md) — how state anchors
  to the Main Chain.
- [Settlement paradigms](concepts/settlement-paradigms.md) — optimistic, zk,
  based, sovereign.
- [Guides](guides/profiles.md) — preset profiles, sequencers, proofs, DA, gas,
  lifecycles, and economics.
- [Network & endpoints reference](reference/network.md) — chain ids, ports,
  token.
