---
id: local-and-dry-run
title: Local & dry-run testing
sidebar_position: 11
---

# Local & dry-run testing

You do not need a running node to learn the kit, write tests, or rehearse a
create/lifecycle flow. The RDK gives you two offline tools — a transaction
**dry run** and a fully offline **mock backend** — plus a **manifest** for saving
and sharing a rollup's configuration.

## Dry run: simulate without broadcasting

A dry run estimates gas for a set of messages without submitting them. `RdkTxClient.simulate`
runs the simulation against the underlying client and returns the gas estimate;
it throws if the client cannot simulate.

```ts
import { createRollupMsg } from "@qorechain/rdk";

const tx = await rdk.connectTx(signer, { gasPrice: "0.025uqor" });

const msg = createRollupMsg({
  creator: tx.address,
  rollupId: "my-roll",
  profile: "defi",
  vmType: "evm",
  stakeAmount: params.minStakeForRollup,
});

const gas = await tx.simulate([msg]); // estimate only — nothing is broadcast
console.log("estimated gas:", gas);
```

The `qorollup create --dry-run` flag uses this idea, but takes it one step
further: it runs the **entire** create flow against the offline mock backend
below, so it needs no node and no funds at all.

```bash
qorollup create --rollup-id my-roll --profile defi --dry-run
# Dry run OK — would submit MsgCreateRollup (no broadcast).
```

## Fully offline: `MockTxClient`

`MockTxClient` is the offline "devnet" equivalent. Drop it into
`RdkTxClient.fromClient(...)` and you can exercise the full
create/submit/lifecycle/withdraw flow without a node: it records every call and
returns a successful, fake transaction result.

```ts
import { MockTxClient, RdkTxClient } from "@qorechain/rdk";

const mock = new MockTxClient();
const tx = RdkTxClient.fromClient(mock, "qor1operator...");

// Drive the same methods you would against a real client.
await tx.createRollup({
  rollupId: "my-roll",
  profile: "defi",
  vmType: "evm",
  stakeAmount: "10000000000",
});
await tx.pauseRollup({ rollupId: "my-roll", reason: "test" });

// Inspect what would have been broadcast.
console.log(mock.calls.length);              // 2
console.log(mock.calls[0].messages[0].typeUrl);
```

`MockTxClient` also implements `simulate`, returning a configurable gas estimate,
so `tx.simulate([...])` works offline too:

```ts
const mock = new MockTxClient({ gasEstimate: 150000 });
const tx = RdkTxClient.fromClient(mock, "qor1operator...");
console.log(await tx.simulate([])); // 150000
```

This is what makes the unit tests and the `--dry-run` path possible: no node, no
keys with funds, deterministic results.

## Rollup manifest: save and share a config

A **manifest** is a portable JSON snapshot of a rollup's resolved config, target
network, endpoints, and key addresses — the `rollup.json` equivalent for this
kit. Commit it, share it with a teammate, or load it back to recreate the exact
configuration.

```ts
import { toManifest, stringifyManifest, parseManifest, fromManifest } from "@qorechain/rdk";

// Build a manifest from a resolved config.
const config = presets.defi({ rollupId: "my-roll" });
const manifest = toManifest(config.get(), {
  network: "testnet",
  chainId: rdk.network.chainId,
  endpoints: rdk.network.endpoints,
  addresses: { creator: "qor1operator..." },
  createdAt: new Date().toISOString(),
});

// Serialize to pretty JSON to save.
const json = stringifyManifest(manifest);

// Load it back into a config builder.
const restored = fromManifest(parseManifest(json));
console.log(restored.get().rollupId);          // "my-roll"
console.log(restored.validationResult().valid); // true
```

`fromManifest` returns a `RollupConfigBuilder`, so you can re-validate, override
fields, and create from a shared manifest.

The CLI wraps both directions:

```bash
qorollup manifest export --rollup-id my-roll --profile defi --out rollup.manifest.json
qorollup manifest import rollup.manifest.json
```

## Next

- [Zero to a live rollup](zero-to-rollup.md) — go from dry run to live.
- [qorollup reference](../reference/cli-qorollup.md) — `create --dry-run`, `manifest`.
- [Troubleshooting](../troubleshooting.md) — common errors and fixes.
