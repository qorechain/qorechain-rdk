---
id: data-availability
title: Data availability
sidebar_position: 4
---

# Data availability

A settlement batch can commit to its data through the batch's `dataHash`. The
**data-availability (DA) backend** decides where that data is made available so
anyone can reconstruct and check the rollup's state. The RDK supports three
settings.

| Backend | Status | Notes |
| --- | --- | --- |
| `native` | The default for every profile | No blob can be posted yet: leave `dataHash` empty |
| `celestia` | **Planned (not yet active)** | Selectable in configs; not served by the network yet |
| `both` | **Planned** (depends on Celestia) | Redundant: native + Celestia |

## `native`

Every rollup profile creates a `native` rollup. The chain has on-chain blob
storage, but **no transaction posts a blob to it yet**. Because of that:

- **Leave `dataHash` empty.** On a `native` (or `both`) rollup the chain accepts
  a non-empty `data_hash` only when a matching blob is stored, so a batch that
  claims one is refused as data unavailable, and the fee is spent. The batch's
  state roots, proof and anchor still bind it.
- `RdkTxClient.submitBatch` refuses such a batch before broadcasting when it can
  read the rollup (a hybrid client with a REST endpoint), and `dataHashError`
  applies the same rule anywhere.
- Keep your batch data available off chain yourself, for example next to your
  sequencer, so others can reconstruct your state.

```ts
import { dataHashError } from "@qorechain/rdk";

await tx.submitBatch({ rollupId, batchIndex, stateRoot, prevStateRoot, txCount });
// no dataHash: dataHashError("native", "0xab...") explains why
```

`buildDaBlob` still computes a size-checked SHA-256 commitment for your own
records; it just must not go into a batch on a `native` rollup until blob
posting exists. The limits it checks, `maxDaBlobSize` (default `2097152` bytes)
and `blobRetentionBlocks` (default `432000`), are the chain's parameters for
that future storage; read them live from `rdk.params()`.

## `celestia` (planned, not yet active)

> **Celestia DA is planned but not yet active on the network.** A configuration
> may target `celestia`, but the network does not serve it yet. The RDK **fails
> gracefully**: configs that select `celestia` validate with a non-fatal
> warning, and attempting to use a non-native backend for live submission raises
> a clear error rather than failing silently.

```ts
import { assertDaBackendAvailable } from "@qorechain/rdk";

// "native" passes; "celestia" / "both" throw a clear, descriptive error today.
assertDaBackendAvailable("native");
```

Guard live submission paths with `assertDaBackendAvailable` so you get an
explicit message if you point at a backend that is not yet active.

## `both` (planned)

The `both` setting writes redundantly to native and Celestia. Because it depends
on Celestia, it is likewise planned and not yet active. For live rollups today,
use `native`.

## Choosing a backend

Use `native` for anything you intend to run on the network now. Select
`celestia` or `both` only when you are deliberately preparing a configuration
for a future in which the Celestia backend is active — and keep the
`assertDaBackendAvailable` guard in your submission path so it fails loudly until
then.
