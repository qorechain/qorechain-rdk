---
id: monitoring
title: Monitoring
sidebar_position: 8
---

# Monitoring a rollup

Once a rollup is live you will want to know its status, whether batches are being
submitted, and — for optimistic settlement — how long until the latest batch
finalizes. The RDK gives you a consolidated health read, a polling watcher, and
event decoding, all built on the read surface (REST). The `qorollup status` and
`qorollup watch` commands are the CLI front for the same calls.

## A health snapshot: `getRollupHealth`

`getRollupHealth` assembles a beginner-friendly snapshot from the rollup record
and its latest settlement batch.

```ts
import { createRdkClient, getRollupHealth } from "@qorechain/rdk";

const rdk = createRdkClient({ endpoints: { rest: "https://api-testnet.qore.host" } });

const health = await getRollupHealth(rdk, "my-roll");

console.log(health.status);             // "pending" | "active" | "paused" | "stopped"
console.log(health.healthy);            // coarse flag: active + latest batch not rejected
console.log(health.hasBatches);         // has any batch been submitted?
console.log(health.latestBatchIndex);   // e.g. 7
console.log(health.latestBatchStatus);  // e.g. "submitted" | "challenged" | "finalized" | "rejected"
console.log(health.latestBatchHeight);  // the height it was submitted at
console.log(health.batchAgeBlocks);     // blocks since then
console.log(health.batchAgeSecs);       // seconds since then — chain v3.2.4+ only
console.log(health.notes);              // human-readable observations
```

`healthy` is intentionally coarse: it is `true` when the rollup is `active` and
the latest batch was not rejected. The `notes` array explains anything off — no
batches yet, a non-active status, a batch under challenge, or a rejected batch.

The CLI prints the same thing:

```bash
qorollup status my-roll
```

## The challenge-window countdown

For optimistic settlement, a batch is not final the moment it is submitted — it
must survive a **challenge window** during which anyone can dispute it with a
fraud proof. `getRollupHealth` reports that window when the latest batch is
`submitted` or `challenged`, computed with the chain's own rules:

```ts
const w = health.challengeWindow;
if (w?.mode === "blocks") {
  console.log(`closes after height ${w.deadlineHeight} (${w.blocksRemaining} blocks)`);
} else if (w?.mode === "time") {
  console.log(`closes at ${w.deadlineSecs} (${w.secondsRemaining}s)`);
}
console.log(w?.open, w?.finalizable); // can it still be challenged? could it finalize now?
```

The chain picks the rule per batch: a batch submitted from chain v3.2.4 is
measured in seconds of block time from its recorded submission time (`mode:
"time"`); every earlier batch, in blocks — `window / 6` of them from the
submission height (`mode: "blocks"`). That older rule assumed 6-second blocks,
so a 7-day window under it closes after about **3.75 days on mainnet** and **28
hours on the testnet**. See [the Watchtower guide](watchtower.md#how-the-challenge-window-is-measured)
for the details, including the one block where a batch is both finalizable and
still challengeable.

The window used is the **rollup's own**, as the node reports it from v3.2.4;
on an older node `getRollupHealth` falls back to the global
`default_challenge_window` and adds a note saying so. It is judged against the
chain tip, read from the RPC endpoint's `/status`; pass `tip` or
`challengeWindowSecs` to set either explicitly. ZK settlement does not use this
window — finalization there is gated by on-chain proof verification.

**Finality in order (chain v3.2.5).** `finalizable` says the batch's *own*
window has passed. From v3.2.5 a batch also waits for every earlier batch to be
final, so when the chain reports `rdk-challenge-settlement` and an earlier batch
is still submitted or challenged, `getRollupHealth` sets
`heldBackBy: { batchIndex, status }` and adds a note naming it.

:::note `submitted_at` is a block height
Releases before 0.6.0 treated it as a Unix timestamp, so their batch age and
countdown were meaningless. They also requested the latest batch from a route
the chain does not serve, and so reported "no batches yet" for every rollup.
:::

## Live polling: `watchRollup`

To follow a rollup continuously, `watchRollup` polls `getRollupHealth` on an
interval and calls your `onUpdate` for each snapshot. It returns a handle with
`stop()`, and also stops on an optional `AbortSignal`.

```ts
import { watchRollup } from "@qorechain/rdk";

const watcher = watchRollup(rdk, "my-roll", {
  intervalMs: 5000,               // default 5000
  onUpdate: (h) =>
    console.log(`[${h.status}] batch #${h.latestBatchIndex ?? "-"} (${h.latestBatchStatus ?? "none"})`),
  onError: (e) => console.warn("poll error:", e), // the loop keeps going
});

// Later:
watcher.stop();
```

Polling errors are passed to `onError` and the loop continues, so a transient
network blip will not kill your watch.

The CLI equivalent runs until Ctrl-C:

```bash
qorollup watch my-roll --interval 2000
```

## Decoding events: `eventsFromTxHash`

After you broadcast a transaction, decode the `rdk` events it emitted — to
confirm a `rollup_created`, a batch submission, or a challenge — directly from
its hash.

```ts
import { eventsFromTxHash } from "@qorechain/rdk";

const events = await eventsFromTxHash(rdk, res.transactionHash);
for (const ev of events) {
  console.log(ev.type, ev.attributes);
}
```

## Next

- [Withdrawals](withdrawals.md) — execute a finalized-batch withdrawal.
- [Lifecycles](lifecycles.md) — the rollup and batch state machines.
- [qorollup reference](../reference/cli-qorollup.md) — `status` and `watch`.
