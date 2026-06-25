---
id: rollups-and-anchoring
title: Rollups & anchoring
sidebar_position: 1
---

# Rollups & anchoring

A rollup on QoreChain is an application-specific chain that runs its own
execution layer off the **Main Chain**, then periodically **anchors** its state
back to QoreChain. Anchoring is the mechanism that ties the rollup's history to
a quantum-safe Layer 1.

## The execution layer

Your rollup executes transactions in its own runtime — `evm`, `cosmwasm`, `svm`,
or a `custom` VM — at its own block time and throughput. This is where your
application's activity lives: trades, game state, mints, enterprise workflows.
The Main Chain is not in the hot path for these transactions, which is what lets
a rollup target high throughput and low latency.

## Anchoring state to the Main Chain

Off-chain execution alone is not verifiable. Anchoring closes that gap. The
rollup groups its activity into **settlement batches** and submits each one to
QoreChain. A batch commits two things:

- A **state root** — a cryptographic commitment to the rollup's new state after
  the batch, along with the previous state root it builds on.
- A **data commitment** — the `dataHash` of the batch's data, so the underlying
  transactions can be made available and checked (see
  [Data availability](../guides/data-availability.md)).

```ts
import { buildDaBlob } from "@qorechain/rdk";

// A batch commits to its data through a dataHash.
const blob = buildDaBlob({ data: new TextEncoder().encode("batch data") });
console.log(blob.dataHash); // place this in the settlement batch
```

Once anchored, the rollup's progress is recorded on the Main Chain. The chain
links each batch to its predecessor by state root, forming a verifiable history.

## Why anchor to a quantum-safe Layer 1?

The anchor is only as durable as the chain that holds it. QoreChain is a
quantum-safe Layer 1: its accounts and transactions support post-quantum
signing. Anchoring a rollup's state roots there means the integrity of the
rollup's history is protected by the same post-quantum posture as the base
chain — the commitments that pin down "what happened" do not rely solely on
classical assumptions that a future quantum adversary could undermine.

## What the paradigm decides

Anchoring is universal, but *how a batch becomes final* depends on the rollup's
**settlement paradigm**:

- **Optimistic** — a batch is accepted on submission and finalizes after a
  challenge window unless someone proves it fraudulent.
- **ZK** — a batch carries a validity proof that is verified on-chain; valid
  proofs finalize immediately.
- **Based** — ordering and inclusion are inherited from host-chain proposers.
- **Sovereign** — the rollup runs its own consensus and settles off the Main
  Chain.

Continue to [Settlement paradigms](settlement-paradigms.md) for how each one
works and when to choose it.
