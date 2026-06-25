---
id: troubleshooting
title: Troubleshooting
sidebar_position: 9
---

# Troubleshooting

Common issues and how to resolve them.

## Validation fails with a compatibility error

The RDK enforces the [compatibility matrix](guides/proof-systems.md) before
anything is submitted. The most common mismatches:

- **`based` settlement with a non-`based` sequencer.** Based settlement requires
  the `based` sequencer mode. Set both to `based` (or start from the `gaming` /
  `enterprise` preset).
- **A proof system that does not match the settlement.** `optimistic` → `fraud`,
  `zk` → `snark` | `stark`, `based` / `sovereign` → `none`.

Inspect the specific problems without throwing:

```ts
const result = config.validationResult();
console.log(result.valid);
console.log(result.errors);   // each mismatch as a message
console.log(result.warnings);
```

## A Celestia warning on validation

Selecting `celestia` (or `both`) DA produces a **non-fatal warning** because the
backend is not yet active. The configuration is otherwise valid. For live
submission today, switch `da` to `native`. If you intend to submit, guard the
path with `assertDaBackendAvailable`, which throws a clear error for
not-yet-active backends. See [Data availability](guides/data-availability.md).

## `assertDaBackendAvailable` throws

This is expected for `celestia` and `both` — they are planned but not yet active.
Use `native` for anything you run on the network now.

## Connection or read errors

`createRdkClient()` defaults to **localhost** endpoints. If reads time out or
refuse the connection, you are likely pointing at localhost without a local
node. Pass explicit `endpoints` for your target network:

```ts
const rdk = createRdkClient({
  endpoints: {
    rest: "https://rest.testnet.example",
    rpc: "https://rpc.testnet.example",
    evmRpc: "https://evm.testnet.example",
  },
});
```

## "No signing key found" when creating or submitting

Signing operations need an `OfflineSigner`. Build one from a raw key or mnemonic:

```ts
import { DirectSecp256k1Wallet } from "@cosmjs/proto-signing";
import { fromHex } from "@cosmjs/encoding";

const signer = await DirectSecp256k1Wallet.fromKey(
  fromHex(process.env.QORE_OPERATOR_PRIVATE_KEY_HEX!.replace(/^0x/, "")),
  "qor",
);
```

Then connect with `await rdk.connectTx(signer)`. For hybrid post-quantum
signing, use the signer from [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk).

## Insufficient funds on rollup creation

Creating a rollup commits a stake and burns a percentage on creation. Confirm
the operator account holds at least the live `minStakeForRollup` (plus fees).
Preview the exact figures with `estimateCreationCost` against the live params —
see [Stake & burn](guides/stake-and-burn.md).

## A stake amount is required to build a create message

`toCreateMsg` needs a stake. Pass it explicitly (using the live minimum is a
safe choice):

```ts
const params = await rdk.params();
const createMsg = config.toCreateMsg(account.address, {
  stakeAmount: params.minStakeForRollup,
});
```

## A batch will not finalize

Finalization depends on the settlement paradigm:

- **Optimistic** — a batch finalizes only after the challenge window closes.
  Check the window with `isChallengeWindowClosed` and the live
  `defaultChallengeWindow`.
- **ZK** — finalization is gated by on-chain proof verification. Confirm the
  batch carried a valid `proof` in the encoding the network's verifier expects.

See [Lifecycles](guides/lifecycles.md).

## A rollup action is rejected

Rollup transitions are state-dependent. You cannot `resume` an `active` rollup
or `pause` a `stopped` one. Check first:

```ts
import { canPerformRollupAction } from "@qorechain/rdk";
canPerformRollupAction("pause", currentStatus);
```

See [Lifecycles](guides/lifecycles.md) for the legal transitions.

## The API reference is missing

The TypeDoc API reference is generated, not committed. Produce it with:

```bash
cd docs
npm run docs:api
```
