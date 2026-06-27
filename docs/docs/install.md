---
id: install
title: Install
sidebar_position: 2
---

# Install

Install the RDK for your language. The TypeScript packages and the Go module are
published; the Python and Rust clients are fully implemented and awaiting their
registry publications (PyPI / crates.io) — until then, build them from the
[monorepo](https://github.com/qorechain/qorechain-rdk).

| Package | Language | Install | Status |
| --- | --- | --- | --- |
| `@qorechain/rdk` | TypeScript | `npm i @qorechain/rdk` | Available (v0.4.0) |
| `@qorechain/rdk-cli` (`qorollup`) | CLI | `npm i -g @qorechain/rdk-cli` | Available (v0.4.0) |
| `qorechain-rdk` | Python | `pip install qorechain-rdk` (imports as `qorrdk`) | Available on PyPI (v0.4.0) |
| `qorechain-rdk` | Go | `go get github.com/qorechain/qorechain-rdk/packages/go` | Available (v0.4.0) |
| `qorechain-rdk` | Rust | `cargo add qorechain-rdk` | Available on crates.io (v0.4.0) |
| `io.github.qorechain:qorechain-rdk` | Java (JVM) | Maven/Gradle (`io.github.qorechain:qorechain-rdk:0.4.0`) | Available on Maven Central (v0.4.0) |
| `create-qorechain-rollup` | CLI | `npm create qorechain-rollup` | Available (v0.4.0) |

The Python, Go, Rust, and Java (JVM) clients are fully implemented and tested in
the [monorepo](https://github.com/qorechain/qorechain-rdk) (config, presets,
utilities, read clients, accounts, and transaction signing + broadcast). Python
is on PyPI (`pip install qorechain-rdk`, imported as `qorrdk`), Rust is on
crates.io (`cargo add qorechain-rdk`), Java is on Maven Central
(`io.github.qorechain:qorechain-rdk`), and Go is installable from the tagged
module.

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

## Operator CLI (`qorollup`)

`@qorechain/rdk-cli` installs the `qorollup` binary for creating, operating, and
monitoring rollups from the command line. It is a thin wrapper over
`@qorechain/rdk`.

```bash
npm i -g @qorechain/rdk-cli
# or run it without installing:
npx @qorechain/rdk-cli doctor
```

It targets Node.js 20+. See the [qorollup reference](reference/cli-qorollup.md)
for every command and flag, and [Zero to a live rollup](guides/zero-to-rollup.md)
for a guided walkthrough.

## Python

```bash
pip install qorechain-rdk
```

Available on PyPI. The distribution installs as `qorechain-rdk` and imports as
`qorrdk` (e.g. `from qorrdk import create_rdk_client`).

## Go

```bash
go get github.com/qorechain/qorechain-rdk/packages/go
```

Available today from the tagged module.

## Rust

```bash
cargo add qorechain-rdk
```

Available on crates.io.

## Java / JVM

Available on Maven Central as `io.github.qorechain:qorechain-rdk`.

Maven:

```xml
<dependency>
  <groupId>io.github.qorechain</groupId>
  <artifactId>qorechain-rdk</artifactId>
  <version>0.4.0</version>
</dependency>
```

Gradle:

```kotlin
implementation("io.github.qorechain:qorechain-rdk:0.4.0")
```

## Scaffolding CLI

`create-qorechain-rollup` scaffolds a complete starter project from one of five
templates:

```bash
npm create qorechain-rollup my-rollup -- --template defi-rollup
```

See the [CLI reference](reference/cli.md) for usage and flags.

## Next

Continue to the [Quickstart](quickstart.md) to connect, read parameters, and
create your first rollup.
