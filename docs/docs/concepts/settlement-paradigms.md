---
id: settlement-paradigms
title: Settlement paradigms
sidebar_position: 2
---

# Settlement paradigms

A rollup's **settlement paradigm** decides how a settlement batch becomes final
once it is anchored to the Main Chain. The RDK supports four, and enforces a
compatibility matrix that ties each paradigm to the sequencer modes and proof
systems it can use.

| Paradigm | Finality | Proofs | Sequencer | Notes |
| --- | --- | --- | --- | --- |
| `optimistic` | Delayed (challenge window) | Interactive fraud proofs | `dedicated` / `shared` | Default 7-day window with a challenge bond |
| `zk` | Instant on a valid proof | SNARK or STARK | `dedicated` / `shared` | On-chain verification gates finalization |
| `based` | ~2 blocks | None | `based` only | Host-chain proposers sequence the rollup |
| `sovereign` | The rollup's own consensus | None | `dedicated` / `shared` | Self-sequenced, settles off the Main Chain |

## `optimistic`

A batch is accepted on submission **without** a proof and finalizes after a
challenge window (default 7 days) unless a challenger proves it fraudulent.
Challenges and the operator's response are interactive fraud proofs, backed by a
challenge bond. Optimistic settlement uses the `fraud` proof system.

**Choose it when** you want low submission overhead and can tolerate delayed
finality — general-purpose app-chains, NFT platforms, anything not latency-
critical.

## `zk`

Each batch carries a validity proof — a `snark` or a `stark`. The proof is
verified on-chain, and a **valid** proof gates finalization, so a verified batch
finalizes immediately with no challenge window. The RDK does not implement or
describe the verifier; your rollup produces proofs in the encoding the network's
on-chain verifier expects.

**Choose it when** you need fast, trust-minimized finality — high-value DeFi,
exchanges, anything that benefits from cryptographic finality without a wait.

## `based`

Ordering and inclusion are inherited from host-chain proposers, giving roughly
two-block finality with no separate proof. Based settlement **requires** the
`based` sequencer mode (the rollup does not run its own sequencer).

**Choose it when** you want fast finality and tight coupling to the host chain's
liveness, and are comfortable delegating sequencing — high-throughput gaming or
enterprise rollups.

## `sovereign`

The rollup runs its own consensus and settles off the Main Chain; it anchors
data but carries no proofs or challenges. Finality is whatever the rollup's own
consensus provides.

**Choose it when** you want maximum autonomy over consensus and settlement and
are using QoreChain primarily for anchoring and data availability.

## Compatibility

The paradigm constrains the proof system and (for `based`) the sequencer mode:

- `optimistic` → `fraud`
- `zk` → `snark` | `stark`
- `based` → `none` (and `based` sequencer mode)
- `sovereign` → `none`

The RDK validates these before anything is submitted. See
[Proof systems](../guides/proof-systems.md) for the full matrix and
[Sequencer modes](../guides/sequencer-modes.md) for the based constraint.
