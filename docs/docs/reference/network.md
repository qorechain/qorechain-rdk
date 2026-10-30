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

## Public endpoints

The network operates public endpoints you can use directly (or run your own
node and point the RDK at it):

| Endpoint | Mainnet | Testnet |
| --- | --- | --- |
| Consensus RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| REST (LCD) | `https://api.qore.host` | `https://api-testnet.qore.host` |
| EVM / `qor_` JSON-RPC | `https://evm.qore.host` | `https://evm-testnet.qore.host` |
| EVM WebSocket | — | `wss://evm-ws-testnet.qore.host` |
| SVM RPC | `https://svm.qore.host` | `https://svm-testnet.qore.host` |
| Consensus WebSocket | `wss://rpc.qore.host/websocket` | `wss://rpc-testnet.qore.host/websocket` |

The public block explorer is [explore.qore.network](https://explore.qore.network).

## Default ports

`createRdkClient({ network })` ships each network's public endpoints by default
(see above). To run against a **local node**, override `endpoints` with these
localhost ports:

| Endpoint | Port | Purpose |
| --- | --- | --- |
| REST (LCD) | `1317` | rollup queries, batches, blobs, module params |
| Consensus RPC | `26657` | signing/broadcasting rollup txs |
| gRPC | `9090` | gRPC queries |
| EVM / `qor_` JSON-RPC | `8545` | `qor_*` calls, including the profile advisory |

Example with explicit endpoints:

```ts
import { createRdkClient } from "@qorechain/rdk";

const rdk = createRdkClient({
  endpoints: {
    rest: "https://api-testnet.qore.host",   // REST (LCD)
    rpc: "https://rpc-testnet.qore.host",      // consensus RPC
    evmRpc: "https://evm-testnet.qore.host",   // EVM + qor_ JSON-RPC
  },
});
```

## Targeting mainnet

Selecting `mainnet` uses the public mainnet endpoints automatically. Override
`endpoints` only to point at your own node URLs:

```ts
const main = createRdkClient({
  network: "mainnet",       // chain id qorechain-vladi
  endpoints: {
    rest: "https://api.qore.host",
    rpc: "https://rpc.qore.host",
    evmRpc: "https://evm.qore.host",
  },
});
```

## Module parameters

Read the live `rdk` module parameters from the chain — never hardcode them:

```ts
const params = await rdk.params();
```

Live values differ by network; read them rather than relying on this table.
Chain v3.2.5 made the parameters governable; mainnet runs it since block
3,906,833 and the testnet since block 8,890,800. On 30 October 2026 the testnet
had `maxRollups` 200 and `defaultChallengeWindow` 3,600 s, and mainnet the
defaults below. Each rollup also registers an `x/multilayer` sidechain layer,
capped by that module's `max_sidechains` (64 on the testnet, 10 on mainnet).

| Parameter | Documented default | Meaning |
| --- | --- | --- |
| `maxRollups` | `100` | Maximum registered rollups (from v3.2.5 a stopped rollup frees its slot) |
| `minStakeForRollup` | `10000000000` uqor (10,000 QOR) | Minimum stake to create a rollup |
| `rollupCreationBurnRate` | `0.01` | Fraction of stake burned on creation |
| `defaultChallengeWindow` | `604800` s | Optimistic challenge window — 7 days of block time from chain v3.2.4; `window / 6` blocks before it (about 3.75 days on mainnet, 28 hours on the testnet). From v3.2.5 a new optimistic rollup takes this value at creation and keeps it. |
| `maxDaBlobSize` | `2097152` bytes (2 MiB) | Maximum native DA blob size |
| `blobRetentionBlocks` | `432000` (~30 days) | Blocks before expired blobs are pruned |
| `maxBatchesPerBlock` | `10` | Maximum settlement batches per block |

These are documented defaults for reference only. The authoritative values come
from `rdk.params()`.
