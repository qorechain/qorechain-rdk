---
id: sequencer-modes
title: Sequencer modes
sidebar_position: 2
---

# Sequencer modes

The **sequencer mode** decides who orders your rollup's transactions before they
are batched and anchored. The RDK supports three.

| Mode | Who sequences | Notes |
| --- | --- | --- |
| `dedicated` | A single operator | Simplest to run; you control ordering |
| `shared` | A distributed sequencer set | Spreads ordering across multiple parties |
| `based` | Host-chain proposers | Required by `based` settlement |

## `dedicated`

A single operator orders the rollup's transactions. This is the simplest mode to
run and the default for `optimistic`, `zk`, and `sovereign` profiles. You hold
sequencing authority and accept the operational responsibility that comes with
it.

## `shared`

Ordering is distributed across a sequencer set rather than a single operator,
reducing reliance on any one party. Use it when you want to decentralize
sequencing while still settling optimistically, with zk proofs, or sovereignly.

## `based`

Sequencing is delegated to **host-chain proposers** — the rollup does not run
its own sequencer, and inclusion is inherited from the host chain. This is what
gives based settlement its fast, host-coupled finality.

## The based constraint

Based settlement and the based sequencer are linked:

> **`based` settlement requires the `based` sequencer mode.** A configuration
> that selects `based` settlement with a `dedicated` or `shared` sequencer is
> rejected by validation.

```ts
import { presets } from "@qorechain/rdk";

// The gaming and enterprise presets already pair based settlement with the
// based sequencer.
const config = presets.gaming({ rollupId: "my-game" });
config.validate(); // ok

// Overriding the sequencer away from "based" while keeping based settlement
// fails validation.
const broken = presets.gaming({ rollupId: "my-game" }).set({ sequencer: "dedicated" });
const result = broken.validationResult();
console.log(result.valid); // false
```

Conversely, the `based` sequencer mode is intended for based settlement; pair
them together. See [Settlement paradigms](../concepts/settlement-paradigms.md)
for the full picture.
