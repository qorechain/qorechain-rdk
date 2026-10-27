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
| `optimistic` | Delayed (challenge window) | Interactive fraud proofs | `dedicated` / `shared` | Default 604,800 s window with a challenge bond (see below) |
| `zk` | Instant on a valid proof | SNARK or STARK | `dedicated` / `shared` | On-chain verification gates finalization |
| `based` | ~2 blocks | None | `based` only | Host-chain proposers sequence the rollup |
| `sovereign` | The rollup's own consensus | None | `dedicated` / `shared` | Self-sequenced, settles off the Main Chain |

## `optimistic`

A batch is accepted on submission **without** a proof and finalizes after a
challenge window (default 604,800 s, nominally 7 days) unless a challenger proves it fraudulent.

How long that is in practice depends on when the batch was submitted. From chain
v3.2.4 the window is measured in seconds of block time, so 604,800 s is 7 days.
Batches submitted before it use the original rule of `window / 6` blocks, which
assumed 6-second blocks: on mainnet (about 3.2 s blocks) that is roughly 3.75
days, on the testnet (about 1 s) roughly 28 hours. See
[how the window is measured](../guides/watchtower.md#how-the-challenge-window-is-measured).
Challenges and the operator's response are interactive fraud proofs, backed by a
challenge bond. Optimistic settlement uses the `fraud` proof system.

**What "fraudulent" means on chain.** The chain does not run your rollup. It
holds the operator to one rule: a batch's published `stateRoot` must equal the
**canonical transition root** of the batch's own inputs (previous root, data
hash, transaction count, and from chain v3.2.5 also the chain id, rollup id and
withdrawals root). A challenge whose proof names that root is upheld whenever
the batch published anything else, and from v3.2.5 any account can resolve it,
paid from the rollup's escrow. Compute the root with `batchTransitionRoot` (see
[Watchtower](../guides/watchtower.md#checking-a-batch-against-the-chains-rule)):
a placeholder or a root from your own scheme is provably fraudulent.

**Choose it when** you want low submission overhead and can tolerate delayed
finality — general-purpose app-chains, NFT platforms, anything not latency-
critical.

## `zk`

Each batch carries a validity proof — a `snark` or a `stark`. The proof is
verified on-chain when the batch is submitted, and a **valid** proof finalizes
the batch immediately, with no challenge window.

:::caution ZK settlement cannot be used yet
The chain verifies a zk batch against a verification key registered on the
rollup, and no chain release up to v3.2.5 has a way to register one: creating a
rollup carries no key and no message sets it. Every zk batch is therefore
refused (code 21) after its fee is paid, on both networks. Key registration is
planned for chain v3.2.7. Until then the `defi` profile, and any zk rollup, can
be created but cannot settle; the `defi-rollup` template stops before
submitting.
:::

What the chain verifies, for when it can: a SNARK is Groth16 over BLS12-381 in
gnark's binary encoding, with public inputs `prev_state_root`, `state_root`,
`data_hash` and (for batches from chain v3.2.5) `withdrawals_root`, each a
big-endian integer reduced into the scalar field. A STARK's transcript also
names the withdrawals root from v3.2.5.

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
