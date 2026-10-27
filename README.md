# qorechain-rdk

Rollup Development Kit for designing, launching, configuring, and operating
application-specific rollups (app-chains) on the QoreChain network — a
quantum-safe Layer 1 with first-class QoreChain Native, EVM/Solidity, and SVM runtimes.

📖 **Documentation:** https://qorechain.github.io/qorechain-rdk/

The RDK is a **client and operator toolkit**. It talks to QoreChain nodes over
their public RPC / REST / gRPC / JSON-RPC surfaces and drives the on-chain `rdk`
module: rollup creation, settlement-batch submission, lifecycle management, and
data-availability queries. It contains no node internals — it is the
developer-facing front door for launching rollups on the network.

## Packages

| Package | Language | Status |
| --- | --- | --- |
| `@qorechain/rdk` | TypeScript | Available (v0.7.1) |
| `@qorechain/rdk-cli` (`qorollup`) | Operator CLI | Available (v0.7.1) |
| `create-qorechain-rollup` | Project scaffolding CLI | Available (v0.7.1) |
| `qorechain-rdk` (Python) | Python | Available on PyPI (v0.7.1) |
| `github.com/qorechain/qorechain-rdk/packages/go` | Go | Available (v0.7.1) |
| `qorechain-rdk` (Rust crate) | Rust | Available on crates.io (v0.7.1) |
| `io.github.qorechain:qorechain-rdk` | Java (JVM) | Available on Maven Central (v0.7.1) |

## What's new

**0.7.1** — the `qorollup` transaction commands (`create`, `pause`, `resume`,
`stop`, `withdraw`) sign hybrid, as both networks require; earlier releases
signed them classical-only and every one was refused. The key is resolved the
way the templates resolve it: from `QORE_MNEMONIC` / `--mnemonic`, or
`QORE_PQC_SEED_HEX` / `--pqc-seed` alongside a raw private key.

**0.7.0** — ready for QoreChain v3.2.5 (the testnet since block 8,890,800):
withdrawal proofs built exactly as the chain checks them, in-order settlement in
the Watchtower and health check, cross-VM allowlist and result decoding, and
pre-checks that refuse a transaction the chain would refuse before any fee is
paid. ZK settlement cannot be used yet: the chain cannot register a
verification key before v3.2.7.

**0.6.x** — settlement receipts bind every field to chain state; the optimistic
templates publish the chain's canonical state root; `qorollup` installed from
npm runs (0.6.2).

The full history is in the [CHANGELOG](CHANGELOG.md).

The RDK's distinctive features, all built on QoreChain itself:

- **QCAI Rollup Copilot** — `getRollupAdvice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings). CLI: `qorollup advise`. *(All five languages.)*
- **Quantum-safe settlement receipts** — `buildSettlementReceipt` /
  `verifySettlementReceipt`: a portable receipt proving a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature, every field verified against live chain state. CLI:
  `qorollup receipt`. *(All five languages.)*
- **Multi-VM tooling** — EVM → QoreChain Native calls through the cross-VM
  precompile, with a readiness check and the `multivm-rollup` template.
  *(TypeScript.)*
- **Watchtower** — `watchBatches`, an auto-challenger framework for optimistic
  rollups, with `transitionRootValidator` / `fraudProofForBatch` applying the
  chain's own fraud rule. CLI: `qorollup watchtower --canonical`. *(TypeScript.)*

The Python, Go, Rust, and Java (JVM) clients mirror the TypeScript surface —
config builder and validation, presets, utilities, Merkle/withdrawal helpers,
manifests, REST and `qor_` JSON-RPC read clients, preflight/health, accounts, and
transaction signing + broadcast — and are verified against shared cross-language
golden vectors. (Live broadcast requires a node endpoint.)

> **PQC signing requirement.** QoreChain requires the hybrid post-quantum
> signature extension (ML-DSA-87 + secp256k1) on native-lane transactions — on
> mainnet (`qorechain-vladi`) and, since v3.1.98, on testnet
> (`qorechain-diana`) too.
>
> **TypeScript signs hybrid when you pass `pqcKeypair`** to `connectTx` /
> `RdkTxClient.connect`, and so do the templates and the `qorollup` CLI (see
> [Keys & funding](https://qorechain.github.io/qorechain-rdk/guides/keys-and-funding)).
> **Python, Go, Rust, and Java remain classical-only** (SIGN_MODE_DIRECT) and are
> therefore unsuitable for native-lane transactions on mainnet or
> `qorechain-diana`: use them on permissive networks (local devnets) or pair them
> with the [`qorechain-pqc`](https://github.com/qorechain/qorechain-pqc) bindings.

The TypeScript package is built first and at the highest polish; the other
language packages mirror the same conceptual surface. The TypeScript RDK depends on
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) for accounts,
quantum-safe signing, and transport.

## What is a rollup on QoreChain?

A rollup is an application-specific chain that executes transactions off the Main
Chain and periodically anchors its state to QoreChain for verifiable,
quantum-safe integrity. You choose how it settles, who sequences it, where its
data lives, and which runtime it exposes.

### Settlement paradigms

| Paradigm | Finality | Proofs | Notes |
| --- | --- | --- | --- |
| `optimistic` | Delayed (challenge window) | Interactive fraud proofs | Default 7-day window with a challenge bond |
| `zk` | Instant on a valid proof | SNARK or STARK | On-chain verification gates finalization |
| `based` | ~2 blocks | None | Host-chain proposers sequence; requires the `based` sequencer mode |
| `sovereign` | The rollup's own consensus | None | Self-sequenced, no proofs or challenges |

### Sequencer modes

`dedicated` (single operator), `shared` (distributed sequencer set), and `based`
(host-chain proposers). Based settlement requires the based sequencer mode.

### Proof systems

`fraud` (optimistic), `snark` and `stark` (zk), and `none` (based / sovereign).
The RDK enforces the compatibility matrix before anything is submitted:
optimistic → fraud, zk → snark | stark, based → none, sovereign → none.

### Data availability

`native` (on-chain blob storage, auto-pruned), `celestia` (a selectable but
**not-yet-active** backend — configs may target it, but the network does not
serve it yet and the kit fails gracefully with a clear message), and `both`
(redundant).

### Preset profiles

Five first-class presets produce sensible, documented defaults you can override
field by field:

| Profile | Settlement | Sequencer | DA | Block time | Gas model | VM | Max tx/block |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `defi` | zk (snark) | dedicated | native | 500 ms | eip1559 | EVM | 10,000 |
| `gaming` | based | based | native | 200 ms | flat | custom | 50,000 |
| `nft` | optimistic | dedicated | celestia | 2,000 ms | standard | QoreChain Native | 5,000 |
| `enterprise` | based | based | native | 1,000 ms | subsidized | EVM | 20,000 |
| `custom` | optimistic | dedicated | native | 1,000 ms | standard | EVM | 10,000 |

A QCAI-assisted `suggestProfile(useCase)` helper recommends a starting profile
from a plain-language description of your app, falling back to `defi` when the
advisory service is unavailable.

## Quickstart (TypeScript)

> The TypeScript package is published at v0.7.1 (`npm i @qorechain/rdk`).

```sh
npm install @qorechain/rdk
```

```ts
import { createRdkClient, presets } from "@qorechain/rdk";

// Targets the public testnet (chain id "qorechain-diana") by default.
// Override endpoints to reach a real node.
const rdk = createRdkClient({
  endpoints: {
    rest: "https://api-testnet.qore.host",
    rpc: "https://rpc-testnet.qore.host",
    evmRpc: "https://evm-testnet.qore.host",
  },
});

// Read live module parameters from the chain (never hardcoded).
const params = await rdk.params();

// Start from a preset, then override fields as needed.
const config = presets.defi({ rollupId: "my-defi-rollup" });

// Validate against the compatibility matrix before submitting.
config.validate();
```

## Operate a rollup from the command line

`qorollup` (the `@qorechain/rdk-cli` package) takes you from zero to a live,
monitored rollup — no code required:

```sh
npx @qorechain/rdk-cli keygen            # generate an operator key
npx @qorechain/rdk-cli doctor            # preflight: endpoints, params, signer, balance
npx @qorechain/rdk-cli create --rollup-id my-roll --profile defi
npx @qorechain/rdk-cli status my-roll    # status + health + challenge-window countdown
npx @qorechain/rdk-cli watch my-roll     # live updates
```

It also covers `suggest`, `pause`/`resume`/`stop`, `manifest export|import`,
`withdraw`, and `faucet`, with `--dry-run` and `--json` everywhere. See the
[zero-to-rollup tutorial](docs/docs/guides/zero-to-rollup.md) and the
[`qorollup` reference](docs/docs/reference/cli-qorollup.md).

The library exposes the same surface for programmatic use: `checkPreflight`
(doctor), `getRollupHealth` / `watchRollup` (monitoring), `signerFromEnv` and
`generateMnemonic` (accounts), `toManifest` / `fromManifest` (manifests),
`assembleWithdrawalProof` (bridge), `MockTxClient` and `RdkTxClient.simulate`
(offline / dry run).

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live). The RDK defaults to testnet.
- Token: `QOR` (display) / `uqor` (base), 10^6 base units per QOR.
- Rollup creation requires a stake (default 10,000 QOR) and burns a small
  percentage on creation (default 1%). The kit reads the live values from the
  chain and shows the cost before you submit.

## License

Apache-2.0. See [LICENSE](./LICENSE).
