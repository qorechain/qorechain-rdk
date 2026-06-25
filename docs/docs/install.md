---
id: install
title: Install
sidebar_position: 2
---

# Install

Install the RDK for your language. The TypeScript package is published first; the
other language packages are coming soon and listed here for completeness. Until
they ship, build them from the
[monorepo](https://github.com/qorechain/qorechain-rdk).

| Package | Language | Install | Status |
| --- | --- | --- | --- |
| `@qorechain/rdk` | TypeScript | `npm i @qorechain/rdk` | Available |
| `qorechain-rdk` | Python | `pip install qorechain-rdk` | Coming soon |
| `qorechain-rdk` | Go | `go get github.com/qorechain/qorechain-rdk/packages/go/...` | Coming soon |
| `qorechain-rdk` | Rust | `cargo add qorechain-rdk` | Coming soon |
| `create-qorechain-rollup` | CLI | `npm create qorechain-rollup` | Coming soon |

## TypeScript

The core package:

```bash
npm i @qorechain/rdk
```

It targets Node.js 20+ and ships ESM, CommonJS, and type definitions.

### Signing dependencies

The RDK accepts any [`@cosmjs`](https://www.npmjs.com/package/@cosmjs/proto-signing)
`OfflineSigner`. For local development with a raw key or mnemonic, install
`@cosmjs/proto-signing`:

```bash
npm i @cosmjs/proto-signing
```

For hybrid post-quantum signing, install
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) and use its
signer in place of the standard one:

```bash
npm i @qorechain/sdk
```

## Python

```bash
pip install qorechain-rdk
```

> Coming soon.

## Go

```bash
go get github.com/qorechain/qorechain-rdk/packages/go/...
```

> Coming soon.

## Rust

```bash
cargo add qorechain-rdk
```

> Coming soon.

## Scaffolding CLI

`create-qorechain-rollup` scaffolds a complete starter project from one of five
templates:

```bash
npm create qorechain-rollup my-rollup -- --template defi-rollup
```

> Coming soon. See the [CLI reference](reference/cli.md) for usage and flags.

## Next

Continue to the [Quickstart](quickstart.md) to connect, read parameters, and
create your first rollup.
