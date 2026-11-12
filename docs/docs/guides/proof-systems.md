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
| `stark` | `zk` | Paused: refused by the chain from v3.2.8 (see below) |
| `none` | `based`, `sovereign` | No proof |

## `fraud` (optimistic)

Optimistic batches are submitted **without** a proof and finalize after the
challenge window. If a batch is challenged, the operator responds with an
interactive fraud proof. See [Lifecycles](lifecycles.md) for the
`SUBMITTED → CHALLENGED → REJECTED` path.

## `snark` (zk)

ZK batches carry a validity proof in the batch's `proof` field. ZK settlement
**requires a valid proof**, and **on-chain verification gates finalization**:
a batch only finalizes once the network's verifier accepts its proof.

The chain verifies the proof against the rollup's verification key: a Groth16
BLS12-381 verifying key in gnark's binary encoding, for a circuit with exactly
four public inputs (`prev_state_root`, `state_root`, `data_hash`,
`withdrawals_root`). From chain v3.2.7 the creator registers it with
`setVerificationKey` (or `verificationKey` on `createRollup`), before the
rollup's first batch; after that only governance can replace it.

**Canonical public inputs (chain v3.2.8).** Each public input is read as a
32-byte big-endian integer, and the chain refuses a batch whose input is not
already below the BLS12-381 scalar modulus. A raw SHA-256 or SHAKE-256 output
is above it about half the time, so:

- commit to state with a field-friendly hash, or reduce with
  `toCanonicalScalar` and prove the reduced value;
- `data_hash` is exempt when the chain fixed it (a based rollup's inbox range,
  or a native-DA hash of posted data); otherwise reduce it too;
- `withdrawals_root` may be any 32 bytes: the chain stores it reduced modulo
  the scalar field and pays a withdrawal when the rebuilt tree root matches it
  modulo the field. The batch view's `withdrawalsRootReduced` says so; compare
  roots with `withdrawalsRootMatches`;
- `zkPublicInputs` returns the four inputs, reduced, in the circuit's order;
- check a batch before paying the fee with `zkPublicInputErrors`;
  `submitBatch` does this for you when it can read the rollup.

```ts
import type { SubmitBatchInput } from "@qorechain/rdk";

const input: SubmitBatchInput = {
  rollupId: "my-defi-rollup",
  batchIndex: 0,
  stateRoot: "0x...",
  prevStateRoot: "0x...",
  txCount: 1,
  proof: "0x...", // the Groth16 proof bytes
};
```

The exact proof encoding is defined by the chain's on-chain verifier; align your
prover's output with it. The RDK transports the proof bytes — it does not
implement, describe, or second-guess the verifier.

## `stark` (paused)

From chain v3.2.8 a STARK verification key cannot be set and a STARK rollup's
batches are refused: the only statement the chain's STARK verifier implements
does not constrain a rollup's roots, withdrawals or data. STARK settlement
returns when the chain verifies a real rollup statement. Governance can move an
existing STARK rollup to a Groth16 key. The RDK keeps `stark` as a known value
so such rollups can be read, and its validation refuses it for new ones.

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
| `zk` | `snark` (`stark` is paused) |
| `based` | `none` |
| `sovereign` | `none` |

A configuration that pairs, say, `optimistic` settlement with `snark` proofs is
rejected by validation. Start from a [preset](profiles.md) to get a matching
pair by default.
