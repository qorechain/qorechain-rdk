---
id: data-availability
title: Data availability
sidebar_position: 4
---

# Data availability

A settlement batch commits to its data through the batch's `dataHash`. The
**data-availability (DA) backend** decides where that data is actually made
available so anyone can reconstruct and check the rollup's state. The RDK
supports three settings.

| Backend | Status | Notes |
| --- | --- | --- |
| `native` | Active | On-chain blob storage, auto-pruned |
| `celestia` | **Planned (not yet active)** | Selectable in configs; not served by the network yet |
| `both` | **Planned** (depends on Celestia) | Redundant: native + Celestia |

## `native` (active)

The native backend stores the batch's blob **on-chain**. It is the only backend
serving today.

- **Maximum blob size:** up to 2 MiB (`maxDaBlobSize`, default `2097152` bytes).
- **Retention:** blobs are retained for roughly 30 days, then **auto-pruned**
  (`blobRetentionBlocks`, default `432000`).

Always read the live limits from `rdk.params()` rather than relying on the
documented defaults.

```ts
import { buildDaBlob } from "@qorechain/rdk";

// buildDaBlob enforces the maximum blob size and computes the SHA-256 dataHash.
const blob = buildDaBlob({ data: new TextEncoder().encode("batch data") });
console.log(blob.size);     // bytes
console.log(blob.dataHash); // place this in the settlement batch

// Read a stored blob back over REST:
// const stored = await rdk.rest.getBlob("my-rollup", blobIndex);
```

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
