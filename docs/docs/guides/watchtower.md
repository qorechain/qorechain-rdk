---
id: watchtower
title: Watchtower
sidebar_position: 15
---

# Watchtower

The Watchtower is an auto-challenger framework for optimistic rollups. It follows
a rollup's settlement batches, judges each batch's challenge window exactly as
the chain does, and — when **your** validity predicate rejects a batch — hands it
to your `onInvalid` callback so you can wire up a challenge.

The framework watches and decides *when*; **you supply the validity check**. The
Watchtower never decides on its own that a batch is fraudulent — it calls your
`validate` function and acts on what you return.

## `watchBatches`

```ts
import { createRdkClient, watchBatches, signerFromEnv, pqcKeypairFromEnv } from "@qorechain/rdk";

const rdk = createRdkClient({ network: "testnet" });

// A connected client to submit challenges (it signs hybrid; see Keys & funding).
const signer = (await signerFromEnv())!;
const [{ address }] = await signer.getAccounts();
const pqc = (await pqcKeypairFromEnv(rdk, address))!;
const tx = await rdk.connectTx(signer, { gasPrice: "0.15uqor", pqcKeypair: pqc.keypair });

const watcher = watchBatches(rdk, "my-roll", {
  onBatch: (batch) => {
    console.log("new batch", batch.batchIndex);
  },

  // Your validity predicate. Return false to flag the batch as invalid.
  validate: async (batch) => {
    return await isBatchValid(batch); // your logic
  },

  // Called when validate() returns false — wire it to a challenge.
  onInvalid: async ({ batch, window }) => {
    if (window && !window.open) return; // too late: the chain would refuse it
    await tx.challengeBatch({
      rollupId: "my-roll",
      batchIndex: batch.batchIndex,
      proof: buildFraudProof(batch), // your fraud proof
    });
  },

  // Called once as a still-open window nears its end.
  onDeadline: ({ batch, window }) => {
    console.warn(`window closing for batch ${batch.batchIndex}`, window);
  },
});

// Later:
watcher.stop();
```

The framework surfaces:

- **new batches** via `onBatch`,
- **invalid batches** (where your `validate` returned `false`) via `onInvalid`, and
- **windows about to close** via `onDeadline` — once per batch, and only while
  the window is still open.

Wiring `onInvalid` to `challengeBatch` turns the Watchtower into a complete
auto-challenger; leave it unset to run in observe-only mode.

## Checking a batch against the chain's rule

The chain upholds a fraud challenge against an optimistic batch exactly when
the batch's published state root differs from the **canonical transition root**
of its inputs and the proof names that root. You can apply the same rule
yourself, so a validity predicate needs no knowledge of the rollup's execution:

```ts
import {
  batchTransitionRoot,
  bytesToHex,
  decodeWireBytes,
  fraudProof,
  transitionRootVersionForBatch,
  type BatchView,
} from "@qorechain/rdk";

async function canonicalRoot(batch: BatchView): Promise<Uint8Array> {
  // The binding this batch is judged by: v2 for batches included at or above
  // the height where chain v3.2.5 was applied, v1 before.
  const version = await transitionRootVersionForBatch(rdk.rest, batch);
  return batchTransitionRoot(
    {
      chainId: rdk.network.chainId,
      rollupId: "my-roll",
      prevStateRoot: decodeWireBytes(batch.prevStateRoot),
      dataHash: decodeWireBytes(batch.dataHash),
      txCount: batch.txCount,
      withdrawalsRoot: decodeWireBytes(batch.withdrawalsRoot),
    },
    version,
  );
}

watchBatches(rdk, "my-roll", {
  validate: async (batch) =>
    bytesToHex(decodeWireBytes(batch.stateRoot)) === bytesToHex(await canonicalRoot(batch)),
  onInvalid: async ({ batch, window }) => {
    if (window && !window.open) return;
    await tx.challengeBatch({
      rollupId: "my-roll",
      batchIndex: batch.batchIndex,
      proof: fraudProof(decodeWireBytes(batch.prevStateRoot), await canonicalRoot(batch)),
    });
  },
});
```

Use the batch's own binding, not the current one: a proof built on the other
binding is dismissed and the bond forfeited. The same functions exist in every
language (`batch_transition_root`, `BatchTransitionRoot`,
`Transition.root`).

## How the challenge window is measured

The chain measures a batch's window one of two ways, and chooses **per batch**.
The Watchtower applies the same rule, and every callback receives it as
`window` (`{ mode, open, finalizable, … }`):

| Batch | Rule | Reported as |
| --- | --- | --- |
| submitted from chain v3.2.4 (`rdk-challenge-window-time`) | closes once block time reaches `submitted_time + window` | `mode: "time"`, `secondsRemaining` |
| submitted before | closes `window / 6` **blocks** after the submission height | `mode: "blocks"`, `blocksRemaining` |

The block-count rule assumed 6-second blocks. Real blocks are about 3.2 seconds
on mainnet and 1 second on the testnet, so a 7-day (604,800 s) window under that
rule closes after roughly **3.75 days on mainnet** and **28 hours on the
testnet**. Plan challenge latency around the real figure, not the nominal one.

On the block-count path the chain refuses a challenge once
`height − submitted_at > window_blocks`, but finalizes once it is `>=` — so for
exactly one block a batch is both finalizable and still challengeable. `window`
reports `open` and `finalizable` separately.

The window used is the **rollup's own** (`challenge_window_sec`, exposed from
chain v3.2.4); the global `default_challenge_window` param is a fallback for
older nodes. Pass `challengeWindowSecs` to set it explicitly.

Windows are judged against the **chain tip** (`/status` on the RPC endpoint),
not your machine's clock: heights are what the block-count rule counts, and
block time is what the time-based rule compares.

## Following every batch

The chain's `Batches` query is paged, 50 per page by default. The Watchtower
reads every page, polling forward from the oldest batch whose window is still
open — so it keeps re-judging a batch as its deadline approaches, and never
stops seeing new batches as the rollup grows.

:::note Releases before 0.6.0
They read the submission height as a Unix timestamp, so every deadline was
wrong and `onDeadline` fired at once for every batch; they read only the first
page of batches; and they judged each batch once, on first sight. Upgrade before
relying on the Watchtower.
:::

## CLI

```bash
qorollup watchtower my-roll
```

`watchtower` runs the framework from the command line, printing new batches and
closing windows until you press Ctrl-C. See the
[qorollup reference](../reference/cli-qorollup.md).
