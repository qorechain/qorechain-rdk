---
id: gas-models
title: Gas models
sidebar_position: 5
---

# Gas models

A rollup's **gas model** decides how it charges for execution. The RDK supports
four. The model is a configuration field — pick the one that matches your
application's fee experience.

| Gas model | Fee behaviour | Typical fit |
| --- | --- | --- |
| `standard` | Fixed per-unit gas price | General-purpose rollups |
| `eip1559` | Base fee + priority tip, adjusts with demand | DeFi and EVM apps wanting market-responsive fees |
| `flat` | Flat fee per transaction | High-throughput apps that want predictable, uniform cost |
| `subsidized` | Operator subsidizes some or all fees | Permissioned / enterprise rollups and onboarding-friendly UX |

## `standard`

A straightforward fixed per-unit gas price. A solid default when you do not need
demand-responsive pricing. Used by the `nft` and `custom` presets.

## `eip1559`

A base fee that adjusts with demand plus an optional priority tip, matching the
fee model EVM developers expect. Used by the `defi` preset.

## `flat`

A flat fee per transaction regardless of computational cost. Predictable and
cheap to reason about for workloads dominated by many small, similar
transactions. Used by the `gaming` preset.

## `subsidized`

The operator subsidizes some or all transaction fees, so end users pay little or
nothing. Useful for permissioned deployments and smooth onboarding. Used by the
`enterprise` preset.

## Setting the gas model

The gas model comes from your preset and can be overridden:

```ts
import { presets } from "@qorechain/rdk";

const config = presets.custom({ rollupId: "my-rollup" }).set({
  gasModel: "eip1559",
});

config.validate();
```

The gas model is independent of the settlement paradigm, sequencer mode, and DA
backend — any gas model can be combined with any valid configuration of those.
