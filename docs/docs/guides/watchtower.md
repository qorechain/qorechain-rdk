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
of its inputs and the proof names that root. `transitionRootValidator` applies
that rule, and `fraudProofForBatch` builds the proof that wins, so a watchtower
needs no knowledge of the rollup's execution:

```ts
import { fraudProofForBatch, transitionRootValidator, watchBatches } from "@qorechain/rdk";

watchBatches(rdk, "my-roll", {
  validate: transitionRootValidator(rdk, "my-roll"),
  onInvalid: async ({ batch, window }) => {
    if (window && !window.open) return; // too late: the chain would refuse it
    const proof = await fraudProofForBatch(rdk, "my-roll", batch);
    if (!proof) return; // honest after all: a challenge would forfeit the bond
    await tx.challengeBatch({ rollupId: "my-roll", batchIndex: batch.batchIndex, proof });
  },
});
```

Both use the binding the chain judges **that batch** by (`v2` for a batch
included at or above the height chain v3.2.5 was applied at, `v1` before); a
proof built on the other binding is dismissed and its bond forfeited. From the
CLI, `qorollup watchtower my-roll --canonical` reports such batches. The
building blocks are `batchTransitionRoot`, `transitionRootVersionForBatch` and
`fraudProof`, in every language.

## Settlement from chain v3.2.5

On a chain running v3.2.5 (`rdk-challenge-settlement`; mainnet since block
3,906,833, the testnet since block 8,890,800):

- **Batches finalize in order.** A batch finalizes once its own window has
  passed **and** the batch before it is final, so a challenged batch holds back
  every batch after it. `getRollupHealth` reports this as `heldBackBy`, and
  `qorollup status` prints it.
- **Any account can resolve a challenge**, not only the rollup creator. The
  outcome is computed on chain from the stored proof; an assertion that does not
  match is refused.
- **An upheld fraud rejects the batch and every later batch that is not final,**
  refunds the bonds of open challenges on them, and the sequencer resubmits from
  the last good root **under the same indexes**. The watchtower therefore tells
  batches apart by index *and* state root, so a resubmitted index is judged
  again, and it never validates a rejected batch.
- **At most 4,096 optimistic batches can wait for finality** at once
  (`MAX_PENDING_OPTIMISTIC_BATCHES`); the next is refused.
- **A rollup cannot be stopped** while its latest batch is submitted or
  challenged; `stopRollup` checks before paying the fee (`stopRollupError`).
- **New optimistic rollups take their window from the module parameter
  `default_challenge_window`** at creation, and keep it: 3,600 s on the testnet,
  604,800 s on mainnet.

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
