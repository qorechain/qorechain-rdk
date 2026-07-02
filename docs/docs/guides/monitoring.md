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
console.log(health.batchAgeSecs);       // seconds since the latest batch was submitted
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
fraud proof. `getRollupHealth` surfaces that countdown when the latest batch is
`submitted` or `challenged`:

```ts
if (health.secondsUntilChallengeDeadline !== undefined) {
  console.log("challenge window closes at", health.challengeDeadlineSecs); // unix seconds
  console.log("seconds remaining:", health.secondsUntilChallengeDeadline); // negative once past
}
```

The deadline is computed as the batch's submission time plus the live
`defaultChallengeWindow` module parameter, so it always reflects the chain's
current setting. Once `secondsUntilChallengeDeadline` reaches zero (or goes
negative) the window has elapsed and the batch can finalize. ZK settlement does
not use this window — finalization there is gated by on-chain proof verification.

`qorollup status` prints the remaining seconds when applicable:

```
latest batch #7 (submitted), age 120s
challenge window closes in 604680s
```

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
