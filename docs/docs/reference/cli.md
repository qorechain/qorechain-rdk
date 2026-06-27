---
id: cli
title: CLI
sidebar_position: 2
---

# CLI reference

`create-qorechain-rollup` scaffolds a complete, ready-to-run rollup starter
project. Each template is built around one of the five [preset
profiles](../guides/profiles.md), plus a `multivm-rollup` starter for cross-VM
(EVM → CosmWasm) calls.

> Published on npm as `create-qorechain-rollup` (run via `npm create
> qorechain-rollup`). To operate an existing rollup, see the
> [`qorollup` reference](cli-qorollup.md).

## Usage

```bash
npm create qorechain-rollup <dir> [options]
# or
npx create-qorechain-rollup <dir> [options]
```

Run without `--yes` for an interactive picker, or pass flags to skip the
prompts.

## Arguments

| Argument | Description |
| --- | --- |
| `<dir>` | Target directory for the new project |

## Options

| Option | Description |
| --- | --- |
| `-t, --template <name>` | Template to use (see below) |
| `--network <name>` | Network preset: `testnet` or `mainnet` |
| `--package-manager <pm>` | Package manager: `pnpm`, `npm`, or `yarn` |
| `-y, --yes` | Skip prompts and use defaults |
| `--no-install` | Do not install dependencies after scaffolding |
| `--local` | Rewrite `@qorechain/*` deps to local file links into the monorepo (for local/dev use before the packages are published) |
| `-h, --help` | Show help |
| `-v, --version` | Print the version |

## Templates

| Template | Profile | Highlights |
| --- | --- | --- |
| `defi-rollup` | `defi` | zk-SNARK / dedicated / native / EIP-1559 / EVM. Includes a reference SNARK prover. |
| `gaming-rollup` | `gaming` | based / based / native / flat gas / custom VM. High throughput, low latency. |
| `nft-rollup` | `nft` | optimistic / dedicated / CosmWasm. Includes the challenge flow and Celestia notice. |
| `enterprise-rollup` | `enterprise` | based / based / native / subsidized gas / EVM. Permissioned-friendly. |
| `custom-rollup` | `custom` | Fully parameterized config with every field documented and validated. |
| `multivm-rollup` | `custom` | EVM rollup that calls CosmWasm via the cross-VM precompile. Includes a `contracts/CrossVmCaller.sol` snippet (EVM → CosmWasm). |

## Examples

```bash
# DeFi starter, interactive prompts for the rest.
npm create qorechain-rollup my-rollup -- --template defi-rollup

# Gaming starter, non-interactive.
npx create-qorechain-rollup my-rollup --template gaming-rollup --yes

# NFT starter wired to local monorepo packages, no install.
npx create-qorechain-rollup my-rollup -t nft-rollup --local --no-install
```

Each scaffolded project includes a `rollup.config.ts` built from its preset, an
`.env.example` for your network and operator key, and scripts to create the
rollup, submit batches, and query status. See the
[Quickstart](../quickstart.md) for the equivalent flow in code.
