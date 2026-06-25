---
id: network
title: Network & endpoints
sidebar_position: 1
---

# Network & endpoints reference

## Mainnet

| Field | Value |
| --- | --- |
| Network preset | `mainnet` |
| Chain id | `qorechain-vladi` (live) |
| Display token | `QOR` |
| Base denomination | `uqor` |
| Base units per QOR | `10^6` |
| Account bech32 prefix | `qor` |
| Validator bech32 prefix | `qorvaloper` |

## Testnet

| Field | Value |
| --- | --- |
| Network preset | `testnet` |
| Chain id | `qorechain-diana` (live) |
| Display token | `QOR` |
| Base denomination | `uqor` |
| Base units per QOR | `10^6` |
| Account bech32 prefix | `qor` |
| Validator bech32 prefix | `qorvaloper` |

> **The RDK defaults to testnet** (`qorechain-diana`). Select `mainnet`
> explicitly to target the live network.

## Default ports

`createRdkClient()` uses these localhost ports by default. Override `endpoints`
to point at a real node.

| Endpoint | Port | Purpose |
| --- | --- | --- |
| Cosmos REST (LCD) | `1317` | rollup queries, batches, blobs, module params |
| Consensus RPC | `26657` | signing/broadcasting rollup txs |
| gRPC | `9090` | gRPC queries |
| EVM / `qor_` JSON-RPC | `8545` | `qor_*` calls, including the profile advisory |

Example with explicit endpoints:

```ts
import { createRdkClient } from "@qorechain/rdk";

const rdk = createRdkClient({
  endpoints: {
    rest: "https://rest.testnet.example",   // REST (LCD)
    rpc: "https://rpc.testnet.example",      // consensus RPC
    evmRpc: "https://evm.testnet.example",   // EVM + qor_ JSON-RPC
  },
});
```

## Targeting mainnet

Both presets ship the same localhost defaults; select `mainnet` and override the
endpoints with your node URLs:

```ts
const main = createRdkClient({
  network: "mainnet",       // chain id qorechain-vladi
  endpoints: {
    rest: "https://rest.mainnet.example",
    rpc: "https://rpc.mainnet.example",
    evmRpc: "https://evm.mainnet.example",
  },
});
```

## Module parameters

Read the live `rdk` module parameters from the chain — never hardcode them:

```ts
const params = await rdk.params();
```

| Parameter | Documented default | Meaning |
| --- | --- | --- |
| `maxRollups` | `100` | Maximum registered rollups |
| `minStakeForRollup` | `10000000000` uqor (10,000 QOR) | Minimum stake to create a rollup |
| `rollupCreationBurnRate` | `0.01` | Fraction of stake burned on creation |
| `defaultChallengeWindow` | `604800` s (7 days) | Optimistic challenge window |
| `maxDaBlobSize` | `2097152` bytes (2 MiB) | Maximum native DA blob size |
| `blobRetentionBlocks` | `432000` (~30 days) | Blocks before expired blobs are pruned |
| `maxBatchesPerBlock` | `10` | Maximum settlement batches per block |

These are documented defaults for reference only. The authoritative values come
from `rdk.params()`.
