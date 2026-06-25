---
id: zero-to-rollup
title: Zero to a live rollup
sidebar_position: 0
---

# Zero to a live testnet rollup

This tutorial takes you from nothing to a running testnet rollup using the
`qorollup` operator CLI: generate a key, fund it, run preflight checks, create
the rollup, and watch it go live. At the end, the same flow is shown in code with
`@qorechain/rdk`.

## Prerequisites

- Node.js 20+.
- Testnet endpoint URLs (REST and consensus RPC).
- A few minutes.

## 1. Install the CLI

```bash
npm i -g @qorechain/rdk-cli
# or use npx for a one-off: npx @qorechain/rdk-cli doctor
```

Point it at the testnet:

```bash
export QORE_NETWORK=testnet
export QORE_REST_URL=https://rest.testnet.example
export QORE_RPC_URL=https://rpc.testnet.example
```

## 2. Generate an operator key

```bash
qorollup keygen
```

This prints a mnemonic and its `qor1…` address. **Store the mnemonic securely
and offline — anyone who has it controls the account.** Wire it into your
environment so the CLI can sign:

```bash
export QORE_MNEMONIC="your twelve or twenty-four words ..."
```

See [Keys & funding](keys-and-funding.md) for hex keys and post-quantum signing.

## 3. Fund the account

Creating a rollup commits a stake and burns a small percentage on creation, so
the operator account needs a balance. On testnet, request funds from a faucet.
The network does not publish a fixed faucet endpoint, so set one:

```bash
export QORE_FAUCET_URL=https://faucet.testnet.example
qorollup faucet qor1youraddress...
```

If you do not have a faucet URL, fund the address by transfer from a funded
account instead. See [Keys & funding](keys-and-funding.md).

## 4. Run preflight (`doctor`)

Before spending anything, confirm you are ready. `doctor` checks the endpoints,
the network, the live module parameters, your config, your signer, and your
balance.

```bash
qorollup doctor --profile defi
```

A healthy run ends with **All checks passed.** If the balance check fails, fund
the account and re-run. If the REST check fails, set `QORE_REST_URL`. See
[Troubleshooting](../troubleshooting.md).

## 5. Create the rollup

```bash
qorollup create --rollup-id my-first-rollup --profile defi
```

The CLI validates the `defi` config against the compatibility matrix, prints the
stake and the amount burned on creation, asks you to confirm, then broadcasts
`MsgCreateRollup`. On success it prints the transaction hash and the
`rollup_created` event.

Want a no-broadcast rehearsal first? Add `--dry-run`:

```bash
qorollup create --rollup-id my-first-rollup --profile defi --dry-run
```

## 6. Check status and watch

```bash
qorollup status my-first-rollup
```

A new rollup starts in `pending` and transitions to `active`. To follow it live:

```bash
qorollup watch my-first-rollup    # Ctrl-C to stop
```

See [Monitoring](monitoring.md) for what the health read means.

## The library equivalent

Everything above maps to `@qorechain/rdk` calls. Here is the same flow in code.

```ts
import {
  createRdkClient,
  presets,
  checkPreflight,
  generateMnemonic,
  deriveNativeAccount,
  directSignerFromPrivateKey,
  getRollupHealth,
} from "@qorechain/rdk";

// Connect to the testnet (default chain id "qorechain-diana").
const rdk = createRdkClient({
  network: "testnet",
  endpoints: {
    rest: "https://rest.testnet.example",
    rpc: "https://rpc.testnet.example",
  },
});

// Generate (or load) an operator key and build a signer.
const mnemonic = generateMnemonic();
const account = await deriveNativeAccount(mnemonic);
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");

// Pick a preset profile.
const config = presets.defi({ rollupId: "my-first-rollup" });

// Preflight: endpoints, params, config, signer, balance.
const preflight = await checkPreflight(rdk, {
  config: config.get(),
  signerAddress: account.address,
  expectedNetwork: "testnet",
});
if (!preflight.ok) {
  for (const c of preflight.checks) console.log(c.status, c.label, c.detail ?? "");
  throw new Error("preflight failed");
}

// Create the rollup.
const params = await rdk.params();
const tx = await rdk.connectTx(signer, { gasPrice: "0.025uqor" });
const createMsg = config.toCreateMsg(account.address, {
  stakeAmount: params.minStakeForRollup,
});
const res = await tx.createRollup(createMsg);
console.log(res.transactionHash);

// Read its health.
const health = await getRollupHealth(rdk, "my-first-rollup");
console.log(health.status, health.healthy);
```

## Next

- [Keys & funding](keys-and-funding.md) — key sources, hybrid signing, faucet.
- [Monitoring](monitoring.md) — health, watching, and the challenge window.
- [Local & dry-run testing](local-and-dry-run.md) — build the whole flow offline.
- [qorollup reference](../reference/cli-qorollup.md) — every command and flag.
