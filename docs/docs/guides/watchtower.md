---
id: watchtower
title: Watchtower
sidebar_position: 15
---

# Watchtower

The Watchtower is an auto-challenger framework for optimistic rollups. It follows
a rollup's settlement batches, surfaces each new batch and its challenge-window
deadline, and — when **your** validity predicate rejects a batch — hands it to
your `onInvalid` callback so you can wire up a challenge.

The framework watches and decides *when*; **you supply the validity check**. The
Watchtower never decides on its own that a batch is fraudulent — it calls your
`validate` function and acts on what you return.

## `watchBatches`

```ts
import { createRdkClient, watchBatches, challengeBatch } from "@qorechain/rdk";

const rdk = createRdkClient({
  endpoints: {
    rest: "https://api-testnet.qore.host",
    rpc: "https://rpc-testnet.qore.host", // needed to broadcast a challenge
  },
});

const watcher = watchBatches(rdk, "my-roll", {
  onBatch: (batch) => {
    console.log("new batch", batch.index);
  },

  // Your validity predicate. Return false to flag the batch as invalid.
  validate: async (batch) => {
    return await isBatchValid(batch); // your logic
  },

  // Called when validate() returns false — wire it to a challenge.
  onInvalid: async (batch) => {
    await challengeBatch(rdk, "my-roll", batch.index /* + your fraud proof */);
  },

  // Called as a batch approaches the end of its challenge window.
  onDeadline: (batch) => {
    console.warn("challenge window closing for batch", batch.index);
  },
});

// Later:
watcher.stop();
```

The framework surfaces:

- **new batches** via `onBatch`,
- **challenge-window deadlines** via `onDeadline`, and
- **invalid batches** (where your `validate` returned `false`) via `onInvalid`.

Wiring `onInvalid` to `challengeBatch` turns the Watchtower into a complete
auto-challenger; leave it unset to run in observe-only mode.

## CLI

```bash
qorollup watchtower my-roll
```

`watchtower` runs the framework from the command line, printing new batches and
challenge-window deadlines until you press Ctrl-C. See the
[qorollup reference](../reference/cli-qorollup.md).
