---
id: proof-systems
title: Proof systems
sidebar_position: 3
---

# Proof systems

A settlement batch's **proof system** determines what (if anything) a batch
carries to demonstrate correctness. The RDK supports four, and ties each to a
settlement paradigm through the compatibility matrix.

| Proof system | Used by | What a batch carries |
| --- | --- | --- |
| `fraud` | `optimistic` | No proof on submission; a fraud proof is supplied only if the batch is challenged |
| `snark` | `zk` | A SNARK validity proof, verified on-chain |
| `stark` | `zk` | A STARK validity proof, verified on-chain |
| `none` | `based`, `sovereign` | No proof |

## `fraud` (optimistic)

Optimistic batches are submitted **without** a proof and finalize after the
challenge window. If a batch is challenged, the operator responds with an
interactive fraud proof. See [Lifecycles](lifecycles.md) for the
`SUBMITTED → CHALLENGED → REJECTED` path.

## `snark` and `stark` (zk)

ZK batches carry a validity proof in the batch's `proof` field. ZK settlement
**requires a valid proof**, and **on-chain verification gates finalization** —
a batch only finalizes once the network's verifier accepts its proof.

```ts
import type { SubmitBatchInput } from "@qorechain/rdk";

const input: SubmitBatchInput = {
  rollupId: "my-defi-rollup",
  batchIndex: 0,
  stateRoot: "0x...",
  prevStateRoot: "0x...",
  txCount: 1,
  dataHash: "0x...",
  proof: "0x...", // the snark/stark validity proof bytes
};
```

The exact proof encoding is defined by the chain's on-chain verifier; align your
prover's output with it. The RDK transports the proof bytes — it does not
implement, describe, or second-guess the verifier.

## `none` (based / sovereign)

Based and sovereign batches carry no proof. For based settlement, inclusion is
inherited from host-chain proposers; for sovereign settlement, correctness is
established by the rollup's own consensus off the Main Chain.

## The compatibility matrix

The settlement paradigm fixes the allowed proof system. The RDK enforces this
before any batch is submitted:

| Settlement | Proof system |
| --- | --- |
| `optimistic` | `fraud` |
| `zk` | `snark` or `stark` |
| `based` | `none` |
| `sovereign` | `none` |

A configuration that pairs, say, `optimistic` settlement with `snark` proofs is
rejected by validation. Start from a [preset](profiles.md) to get a matching
pair by default.
