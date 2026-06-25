---
id: lifecycles
title: Lifecycles
sidebar_position: 6
---

# Lifecycles

The RDK tracks two state machines: the **rollup lifecycle** (the rollup itself)
and the **settlement-batch lifecycle** (each anchored batch). It exposes
helpers to check which transitions are legal before you submit.

## Rollup lifecycle

A rollup moves through four states. The creator drives the transitions.

```
PENDING ──▶ ACTIVE ──▶ PAUSED ──▶ STOPPED
              ▲           │
              └───────────┘
              (resume)
```

| State | Meaning |
| --- | --- |
| `pending` | Created and registered, not yet producing batches |
| `active` | Operating normally; accepting settlement batches |
| `paused` | Temporarily halted by the creator; resumable |
| `stopped` | Permanently halted |

Creator-driven transitions:

- **pause** — `active` → `paused`
- **resume** — `paused` → `active`
- **stop** — `active` or `paused` → `stopped` (terminal)

The RDK guards these transitions so you do not submit an illegal one:

```ts
import { canPerformRollupAction, assertRollupAction } from "@qorechain/rdk";

canPerformRollupAction("pause", "active"); // true
canPerformRollupAction("resume", "active"); // false

// Throws if the action is not legal from the current status.
assertRollupAction("stop", "paused"); // ok

// The tx client exposes the matching operations:
// await tx.pauseRollup({ rollupId });
// await tx.resumeRollup({ rollupId });
// await tx.stopRollup({ rollupId });
```

## Settlement-batch lifecycle

Each settlement batch has its own states. The happy path is
`SUBMITTED → FINALIZED`. Under optimistic settlement, a batch can additionally be
challenged.

```
SUBMITTED ──▶ FINALIZED
    │
    └──▶ CHALLENGED ──▶ REJECTED          (optimistic only)
```

| State | Meaning |
| --- | --- |
| `submitted` | Anchored, awaiting finalization |
| `challenged` | Disputed during the optimistic challenge window |
| `finalized` | Final and irreversible |
| `rejected` | Found invalid and discarded |

- **Optimistic:** a batch is `submitted`, and if it survives the challenge
  window it becomes `finalized`. A challenger can move it to `challenged`; an
  upheld challenge ends in `rejected`.
- **ZK:** a batch is `submitted` with a validity proof and `finalized` once the
  on-chain verifier accepts it.
- **Based / sovereign:** a batch is `submitted` and finalizes per the paradigm.

### Challenge-window math

For optimistic rollups, the RDK helps you reason about the challenge window:

```ts
import {
  challengeWindowDeadline,
  isChallengeWindowClosed,
  isBatchFinal,
} from "@qorechain/rdk";

// Read the live window from rdk.params().defaultChallengeWindow (seconds).
const deadline = challengeWindowDeadline(submittedAtSecs, windowSecs);
const closed = isChallengeWindowClosed(submittedAtSecs, windowSecs, nowSecs);

isBatchFinal("finalized"); // true
isBatchFinal("submitted"); // false
```

See [Settlement paradigms](../concepts/settlement-paradigms.md) and
[Proof systems](proof-systems.md) for how each paradigm drives finalization.
