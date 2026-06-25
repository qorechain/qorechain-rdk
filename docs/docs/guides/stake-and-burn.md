---
id: stake-and-burn
title: Stake & burn
sidebar_position: 7
---

# Stake & burn

Creating a rollup commits a **stake** and burns a small **percentage** of it on
creation. Both are governed by live chain parameters — always read them from
`rdk.params()` before sizing a transaction rather than trusting the documented
defaults.

## The economics

- **Creation stake** — the amount you commit to register a rollup. Documented
  default: **10,000 QOR** (`minStakeForRollup`, `"10000000000"` uqor).
- **Creation burn** — a fraction of the committed stake burned on creation.
  Documented default: **1%** (`rollupCreationBurnRate`, `"0.01"`).

The stake leaves your wallet on creation; the burn is taken from it, and the
remainder is the net stake held against the rollup.

## Read live values

```ts
import { createRdkClient } from "@qorechain/rdk";

const rdk = createRdkClient();
const params = await rdk.params();

console.log(params.minStakeForRollup);      // e.g. "10000000000" (uqor)
console.log(params.rollupCreationBurnRate); // e.g. "0.01"
```

## Estimate the cost before submitting

`estimateCreationCost` computes the burn, the net stake, and the total leaving
your wallet. Pass the **live** burn rate from `rdk.params()` for an exact figure.

```ts
import { estimateCreationCost, uqorToQor } from "@qorechain/rdk";

const cost = estimateCreationCost({
  stakeUqor: params.minStakeForRollup,
  burnRate: params.rollupCreationBurnRate,
});

console.log("stake:      ", uqorToQor(cost.stakeUqor), "QOR");
console.log("burn:       ", uqorToQor(cost.burnUqor), "QOR");
console.log("net stake:  ", uqorToQor(cost.netStakeUqor), "QOR");
console.log("total req'd:", uqorToQor(cost.totalRequiredUqor), "QOR");
console.log("burn rate:  ", cost.burnRate);
```

`CreationCost` fields, all in base `uqor`:

| Field | Meaning |
| --- | --- |
| `stakeUqor` | The stake you commit |
| `burnUqor` | The amount burned on creation |
| `netStakeUqor` | Stake remaining after the burn |
| `totalRequiredUqor` | Total leaving your wallet (equal to the committed stake) |
| `burnRate` | The burn rate applied (decimal string) |

## Wire it into creation

Pass the stake when turning a config into a create message:

```ts
const createMsg = config.toCreateMsg(account.address, {
  stakeAmount: params.minStakeForRollup,
});
const res = await tx.createRollup(createMsg);
```

Show the estimated cost to the operator before broadcasting so there are no
surprises. QOR has 10^6 base `uqor` units — use `qorToUqor` / `uqorToQor` to
convert. See the [Quickstart](../quickstart.md) for the full create flow.
