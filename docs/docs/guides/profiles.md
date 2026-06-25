---
id: profiles
title: Preset profiles
sidebar_position: 1
---

# Preset profiles

The RDK ships five first-class **preset profiles**. Each one returns a
`RollupConfigBuilder` pre-filled with documented, sensible defaults that you can
override field by field. The presets are the fastest way to a valid
configuration.

```ts
import { presets } from "@qorechain/rdk";

const config = presets.defi({ rollupId: "my-defi-rollup" });
```

## Comparison

| Profile | Settlement | Sequencer | DA | Block time | Gas model | VM | Max tx/block |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `defi` | zk (snark) | dedicated | native | 500 ms | eip1559 | EVM | 10,000 |
| `gaming` | based | based | native | 200 ms | flat | custom | 50,000 |
| `nft` | optimistic | dedicated | celestia | 2,000 ms | standard | CosmWasm | 5,000 |
| `enterprise` | based | based | native | 1,000 ms | subsidized | EVM | 20,000 |
| `custom` | optimistic | dedicated | native | 1,000 ms | standard | EVM | 10,000 |

> The `nft` preset targets Celestia DA, which is selectable but
> **not yet active** on the network. It validates with a non-fatal warning;
> switch its `da` to `native` for live submission today. See
> [Data availability](data-availability.md).

## When to use each

- **`defi`** — high-value, latency-sensitive financial apps that want fast,
  cryptographic finality. zk-SNARK settlement with EIP-1559 fees on the EVM.
- **`gaming`** — high-throughput, low-latency apps. Based settlement and a
  based sequencer with flat gas on a custom VM, tuned for many small
  transactions per block.
- **`nft`** — general-purpose minting and marketplaces on CosmWasm with
  optimistic settlement and a simple standard gas model.
- **`enterprise`** — permissioned-friendly EVM rollups with subsidized gas and
  based settlement for predictable, host-coupled finality.
- **`custom`** — a fully parameterized starting point with every field
  documented; override freely.

## Overriding fields

Use `.set({ ... })` to override any field; the compatibility matrix is enforced
when you validate or build.

```ts
const config = presets.defi({ rollupId: "my-defi-rollup" }).set({
  blockTimeMs: 400,
  maxTxPerBlock: 8000,
});

config.validate(); // throws if the overrides break the matrix
```

## QCAI-assisted profile suggestion

If you are not sure which profile fits, describe your app in plain language and
let the QCAI-assisted advisory recommend a starting point. It calls a JSON-RPC
advisory method and normalizes the answer to one of the five profiles. If the
service is unreachable or returns something unrecognized, it **falls back to
`defi`** and reports `source: "fallback"`, so it is always safe to call.

```ts
import { createRdkClient } from "@qorechain/rdk";

const rdk = createRdkClient();

const suggestion = await rdk.suggestProfile("high-frequency DeFi DEX");
console.log(suggestion.profile); // e.g. "defi"
console.log(suggestion.source);  // "advisory" or "fallback"

// Then build from the suggested profile:
const config = presets[suggestion.profile]({ rollupId: "my-rollup" });
```

You can also override the fallback profile with `{ fallback: "gaming" }`.

The advisory is a *starting point*, not a guarantee — always review the
resulting configuration and validate it before creating the rollup.
