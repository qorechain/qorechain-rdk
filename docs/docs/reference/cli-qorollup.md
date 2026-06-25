---
id: cli-qorollup
title: qorollup (operator CLI)
sidebar_position: 3
---

# `qorollup` — the operator CLI

`qorollup` is the command line for creating, operating, and monitoring rollups
on the QoreChain network. It is a thin, friendly wrapper over
[`@qorechain/rdk`](https://www.npmjs.com/package/@qorechain/rdk): every command
maps to a documented library call, so anything the CLI does you can also do in
code.

## Install

```bash
npm i -g @qorechain/rdk-cli
# or run it without installing:
npx @qorechain/rdk-cli doctor
```

The package ships the `qorollup` binary and targets Node.js 20+.

## Configure

`qorollup` reads endpoints and signing material from flags or `QORE_*`
environment variables. Flags always win over environment variables.

```bash
export QORE_NETWORK=testnet              # or mainnet (default: testnet)
export QORE_REST_URL=https://rest...     # Cosmos REST (LCD) — reads
export QORE_RPC_URL=https://rpc...        # consensus RPC — signing/broadcast
export QORE_EVM_RPC_URL=https://evm...    # EVM + qor_ JSON-RPC
export QORE_MNEMONIC="word word ..."      # signer (mnemonic)
# or, instead of a mnemonic:
export QORE_OPERATOR_PRIVATE_KEY_HEX=0x...  # signer (raw hex key)
export QORE_GAS_PRICE=0.025uqor           # gas price for "auto" fees
export QORE_FAUCET_URL=https://faucet...  # testnet faucet endpoint (no fixed default)
```

The default endpoints point at **localhost**, so set `QORE_REST_URL` (and, for
signing, `QORE_RPC_URL`) — or pass `--rest`/`--rpc` — to talk to a real node.

### Global flags

| Flag | Meaning |
| --- | --- |
| `--network testnet\|mainnet` | Target network. Default `testnet`. |
| `--rest <url>` | REST (LCD) endpoint override (or `QORE_REST_URL`). |
| `--rpc <url>` | Consensus RPC endpoint, used for signing (or `QORE_RPC_URL`). |
| `--evm-rpc <url>` | EVM / `qor_` JSON-RPC endpoint (or `QORE_EVM_RPC_URL`). |
| `--mnemonic <value>` | Signer mnemonic (or `QORE_MNEMONIC`). |
| `--key <hex>` | Signer raw hex key (or `QORE_OPERATOR_PRIVATE_KEY_HEX`). |
| `--profile <name>` | `defi`, `gaming`, `nft`, `enterprise`, or `custom`. |
| `--json` | Machine-readable JSON output. |
| `-y, --yes` | Skip confirmation prompts. |
| `-h, --help` | Show help. |
| `-v, --version` | Print the version. |

Read commands (`status`, `watch`, `params`, `suggest`, `doctor`) need only a
REST endpoint. Anything that broadcasts a transaction (`create`, `pause`,
`resume`, `stop`, `withdraw`) also needs a signer and an RPC endpoint.

## Commands

### `doctor`

Run preflight checks before you create or operate a rollup: REST reachable,
network as expected, module parameters readable, config valid (when a
`--profile` is given), a signer configured, and the operator balance covering
the stake plus a fee buffer. Each check prints `ok`, `warn`, or `fail` with a
hint. Exit code is `0` only when nothing failed (warnings are allowed).

```bash
qorollup doctor
qorollup doctor --profile defi --rest https://rest.testnet.example
qorollup doctor --json
```

This is the `checkPreflight` library call. See the
[zero-to-rollup guide](../guides/zero-to-rollup.md).

### `create`

Create a rollup from a preset profile. The command validates the config against
the compatibility matrix, reads live module parameters, prints the stake and the
amount burned on creation, asks for confirmation, then broadcasts
`MsgCreateRollup`. The signer's address is the creator.

```bash
qorollup create --rollup-id my-roll --profile defi
qorollup create --rollup-id my-roll --profile defi --stake-uqor 12000000000
qorollup create --rollup-id my-roll --profile defi -y
```

| Flag | Meaning |
| --- | --- |
| `--rollup-id <id>` | Required. The rollup id. |
| `--profile <name>` | Preset profile. Default `defi`. |
| `--stake-uqor <amount>` | Stake in `uqor`. Default: the live `minStakeForRollup`. |
| `--dry-run` | Validate and price the rollup, then run the create flow against an offline mock — **no broadcast**. |

`--dry-run` exercises the full create path without a node, using the in-library
`MockTxClient`. Use it to confirm your config and cost before spending anything:

```bash
qorollup create --rollup-id my-roll --profile defi --dry-run
# Dry run OK — would submit MsgCreateRollup (no broadcast).
```

See [Local & dry-run testing](../guides/local-and-dry-run.md).

### `status`

Show a rollup's status, profile, settlement mode, DA backend, VM, and a
consolidated health read (latest batch, its age, and — for optimistic batches —
the challenge-window countdown).

```bash
qorollup status my-roll
qorollup status my-roll --json
```

This combines `rest.getRollup` and `getRollupHealth`. See
[Monitoring](../guides/monitoring.md).

### `watch`

Poll a rollup's health on an interval and print each snapshot until you press
Ctrl-C.

```bash
qorollup watch my-roll
qorollup watch my-roll --interval 2000
```

| Flag | Meaning |
| --- | --- |
| `--interval <ms>` | Poll interval in milliseconds. Default `5000`. |

This is the `watchRollup` helper.

### `params`

Print the live module parameters: max rollups, min stake, creation burn rate,
default challenge window, max DA blob size, blob retention, and max batches per
block.

```bash
qorollup params
qorollup params --json
```

### `suggest`

Ask the QCAI-assisted advisory for a starting profile, given a plain-language
description of your app. Falls back to `defi` when the advisory is unavailable.

```bash
qorollup suggest "high-frequency DeFi DEX"
# Suggested profile: defi (source: advisory)
```

### `pause` / `resume` / `stop`

Lifecycle transitions for a rollup you created. The CLI reads the current status,
guards the transition (you cannot `resume` an `active` rollup or `pause` a
`stopped` one), confirms, then broadcasts. **Creator only.**

```bash
qorollup pause my-roll --reason "maintenance"
qorollup resume my-roll
qorollup stop my-roll -y
```

| Flag | Meaning |
| --- | --- |
| `--reason <text>` | Optional reason, attached to `pause`. |

### `keygen`

Generate a new operator key — a mnemonic and its derived `qor1…` address. The
mnemonic is printed once; store it securely and offline.

```bash
qorollup keygen
qorollup keygen --json
```

This wraps `generateMnemonic` + `deriveNativeAccount`. See
[Keys & funding](../guides/keys-and-funding.md).

### `manifest export` / `manifest import`

A rollup **manifest** is a portable JSON snapshot of a rollup's resolved config,
target network, endpoints, and key addresses — save it, commit it, share it, and
load it back.

```bash
# Write a manifest for a profile-derived config.
qorollup manifest export --rollup-id my-roll --profile defi --out rollup.manifest.json

# Load a manifest and validate it.
qorollup manifest import rollup.manifest.json
```

| Flag | Meaning |
| --- | --- |
| `--rollup-id <id>` | Required for `export`. |
| `--profile <name>` | Profile for `export`. Default `defi`. |
| `--out <file>` | Write `export` output to a file (otherwise printed). |

`export` is `toManifest`; `import` is `parseManifest` + `fromManifest`. See
[Local & dry-run testing](../guides/local-and-dry-run.md).

### `withdraw`

Assemble a withdrawal proof from a batch's withdrawal leaves and submit
`MsgExecuteWithdrawal`. The withdrawal spec is a JSON file.

```bash
qorollup withdraw --file withdrawal.json
qorollup withdraw --file withdrawal.json --dry-run
```

| Flag | Meaning |
| --- | --- |
| `--file <json>` | Required. The withdrawal spec (see below). |
| `--dry-run` | Assemble the proof and report it without broadcasting. |

The spec file:

```json
{
  "rollupId": "my-roll",
  "batchIndex": 7,
  "recipient": "qor1recipient...",
  "denom": "uqor",
  "amount": "1000000",
  "leaves": ["<hex leaf 0>", "<hex leaf 1>", "..."],
  "index": 3
}
```

> The leaf encoding and hash **must** match the network's `withdrawals_root`
> construction. See [Withdrawals](../guides/withdrawals.md).

### `faucet`

Request testnet funds for an address from a configured faucet. The network does
not publish a fixed faucet endpoint, so you must supply one via `QORE_FAUCET_URL`
or `--faucet-url`; without it the command fails with a clear message.

```bash
export QORE_FAUCET_URL=https://faucet.testnet.example
qorollup faucet qor1youraddress...
```

This is the `requestFaucet` helper. See [Keys & funding](../guides/keys-and-funding.md).

## Exit codes

`0` on success, `1` on a failed check, validation error, cancelled prompt, or a
non-zero transaction code. With `--json`, the same status is reflected in the
emitted object.
