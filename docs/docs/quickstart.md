---
id: quickstart
title: Quickstart
sidebar_position: 3
---

# Quickstart

From zero to a live testnet rollup. This page uses the TypeScript RDK
(`@qorechain/rdk`).

You will: connect a client, read the live module parameters, pick a preset
profile, validate it against the compatibility matrix, create the rollup, and
query its status.

## Prerequisites

- Node.js 20+.
- A funded operator account on your target network (creating a rollup requires a
  stake and burns a small percentage on creation).
- Node endpoint URLs for your target network.

```bash
npm i @qorechain/rdk @cosmjs/proto-signing
```

## 1. Connect

`createRdkClient()` resolves a network and composes the read clients, parameter
queries, lifecycle helpers, and a lazy signing entrypoint. It targets the public
testnet (chain id `qorechain-diana`) by default. The default endpoints point at
**localhost**, so pass `endpoints` to talk to a real node.

```ts
import { createRdkClient } from "@qorechain/rdk";

// Testnet (chain id "qorechain-diana"), default localhost endpoints.
const rdk = createRdkClient();

// Point at a real node by overriding endpoints.
const remote = createRdkClient({
  endpoints: {
    rest: "https://api-testnet.qore.host",   // Cosmos REST (LCD)
    rpc: "https://rpc-testnet.qore.host",      // consensus RPC (for signing)
    evmRpc: "https://evm-testnet.qore.host",   // EVM + qor_ JSON-RPC
  },
});
```

## 2. Read live parameters

Always read the authoritative module parameters from the chain rather than
relying on documented defaults — they govern stakes, blob sizes, and challenge
windows.

```ts
const params = await rdk.params();

console.log(params.minStakeForRollup);      // e.g. "10000000000" uqor
console.log(params.rollupCreationBurnRate); // e.g. "0.01"
console.log(params.maxDaBlobSize);          // e.g. 2097152 bytes
console.log(params.defaultChallengeWindow); // e.g. 604800 s
```

## 3. Pick a preset profile

Each preset returns a `RollupConfigBuilder` pre-filled with that profile's
documented defaults. Override any field with `.set({ ... })`.

```ts
import { presets } from "@qorechain/rdk";

// DeFi: zk-SNARK settlement, dedicated sequencer, native DA, EIP-1559 gas, EVM.
const config = presets.defi({ rollupId: "my-defi-rollup" });

// Optionally override fields; the matrix is enforced on validation/build.
config.set({ blockTimeMs: 400 });
```

Not sure which profile fits? Ask the QCAI-assisted advisory for a starting
point. It falls back to `defi` when the advisory service is unavailable.

```ts
const suggestion = await rdk.suggestProfile("high-frequency DeFi DEX");
console.log(suggestion.profile); // e.g. "defi"
console.log(suggestion.source);  // "advisory" or "fallback"
```

See [Preset profiles](guides/profiles.md) for the full comparison table.

## 4. Validate

Run the configuration through the on-chain rules — the settlement → proof
matrix, the based-settlement constraint, and value/field checks — without
touching the network.

```ts
// Throws RollupConfigError on the first problem.
config.validate();

// Or inspect without throwing:
const result = config.validationResult();
console.log(result.valid);    // boolean
console.log(result.errors);   // string[]
console.log(result.warnings); // string[] (e.g. a Celestia "not yet active" notice)
```

## 5. Create the rollup

Build an offline signer, connect a `RdkTxClient`, and submit the create message.
The RDK accepts any `@cosmjs` `OfflineSigner`; here we use a raw key for local
development. For hybrid post-quantum signing, swap in the
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) signer.

```ts
import { DirectSecp256k1Wallet } from "@cosmjs/proto-signing";
import { fromHex } from "@cosmjs/encoding";

// Build a signer from a hex private key, bound to the "qor" prefix.
const signer = await DirectSecp256k1Wallet.fromKey(
  fromHex(process.env.QORE_OPERATOR_PRIVATE_KEY_HEX!.replace(/^0x/, "")),
  "qor",
);
const [account] = await signer.getAccounts();

// Connect a signing tx client.
const tx = await rdk.connectTx(signer, { gasPrice: "0.15uqor" });

// Turn the config into a create message (commit a stake), then broadcast.
const createMsg = config.toCreateMsg(account.address, {
  stakeAmount: params.minStakeForRollup,
});
const res = await tx.createRollup(createMsg);

console.log(res.transactionHash);
```

Before committing the stake, you can preview the cost with
`estimateCreationCost` using the live burn rate — see
[Stake & burn](guides/stake-and-burn.md).

## 6. Query status

Read the rollup back over REST to confirm it registered and watch its lifecycle.

```ts
const rollup = await rdk.rest.getRollup("my-defi-rollup");
console.log(rollup.status); // "pending" → "active" → ...
```

A newly created rollup starts in `pending` and transitions to `active`. See
[Lifecycles](guides/lifecycles.md) for the full state machine.

## Next

- [Preset profiles](guides/profiles.md) — choose and customize a profile.
- [Settlement paradigms](concepts/settlement-paradigms.md) — pick how your
  rollup settles.
- [Stake & burn](guides/stake-and-burn.md) — read live costs before submitting.
- [Network & endpoints reference](reference/network.md).
