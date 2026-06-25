---
id: faq
title: FAQ
sidebar_position: 8
---

# FAQ

### What is the RDK?

The Rollup Development Kit is a client and operator toolkit for designing,
launching, configuring, and operating application-specific rollups on QoreChain.
It talks to nodes over their public RPC / REST / gRPC / JSON-RPC surfaces and
drives rollup creation, settlement-batch submission, lifecycle management, and
data-availability queries. It contains no node internals.

### How is the RDK related to the QoreChain SDK?

The TypeScript RDK depends on [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)
for accounts, transport, and quantum-safe signing. The SDK is the general dApp
developer kit; the RDK is the rollup-specific toolkit built on top of it.

### Which languages are supported?

The TypeScript package (`@qorechain/rdk`) is the reference and at the highest
polish, alongside the `qorollup` operator CLI and the `create-qorechain-rollup`
scaffolder (all on npm). The Python, Go, and Rust clients mirror the full surface
— config, presets, utilities, read clients, accounts, and transaction signing +
broadcast — and are verified against shared cross-language golden vectors. Go is
installable today via `go get`; the Python (PyPI) and Rust (crates.io)
publications are pending.

### Which network does the RDK target by default?

Testnet (`qorechain-diana`). Select `mainnet` (`qorechain-vladi`) explicitly to
target the live network. Both presets ship localhost endpoint defaults, so pass
`endpoints` to reach a real node.

### How do I choose a settlement paradigm?

See [Settlement paradigms](concepts/settlement-paradigms.md). In short:
`optimistic` for general-purpose app-chains that tolerate delayed finality, `zk`
for fast trust-minimized finality, `based` for host-coupled finality with a
based sequencer, and `sovereign` for maximum autonomy over consensus.

### What does it cost to create a rollup?

Creating a rollup commits a stake (documented default 10,000 QOR) and burns a
small percentage on creation (documented default 1%). Read the live values from
`rdk.params()` and preview the total with `estimateCreationCost`. See
[Stake & burn](guides/stake-and-burn.md).

### Can I use Celestia for data availability?

Celestia DA is **planned but not yet active**. Configurations may select it and
will validate with a non-fatal warning, but the network does not serve it yet
and the kit fails gracefully with a clear error if you try to use it for live
submission. Use `native` today. See [Data availability](guides/data-availability.md).

### Do I have to use a preset?

No. Presets are convenient, validated starting points. You can build a fully
custom configuration with `RollupConfigBuilder` and `.set({ ... })`; validation
enforces the same compatibility matrix either way.

### What does the QCAI-assisted profile suggestion do?

`suggestProfile(useCase)` takes a plain-language description of your app and
recommends one of the five preset profiles as a starting point. If the advisory
service is unavailable, it falls back to `defi` and reports
`source: "fallback"`. It is a starting point — always review and validate the
resulting configuration. See [Preset profiles](guides/profiles.md).

### Which signer should I use?

The RDK accepts any `@cosmjs` `OfflineSigner`. For local development, a
`DirectSecp256k1Wallet` from a raw key works. For hybrid post-quantum signing,
use the signer from [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk).

### Where is the full API reference?

Generate it with `npm run docs:api` from the `docs` directory. See the
[API reference](reference/api.md).
