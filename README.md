# qorechain-rdk

Rollup Development Kit for designing, launching, configuring, and operating
application-specific rollups (app-chains) on the QoreChain network — a
quantum-safe Layer 1 with first-class CosmWasm, EVM/Solidity, and SVM runtimes.

The RDK is a **client and operator toolkit**. It talks to QoreChain nodes over
their public RPC / REST / gRPC / JSON-RPC surfaces and drives the on-chain `rdk`
module: rollup creation, settlement-batch submission, lifecycle management, and
data-availability queries. It contains no node internals — it is the
developer-facing front door for launching rollups on the network.

## Packages

| Package | Language | Status |
| --- | --- | --- |
| `@qorechain/rdk` | TypeScript | In development (v0.1.0) |
| `qorechain-rdk` (Python) | Python | Coming soon |
| `qorechain-rdk` (Go) | Go | Coming soon |
| `qorechain-rdk` (Rust) | Rust | Coming soon |
| `create-qorechain-rollup` | Project scaffolding CLI | Coming soon |

The TypeScript package is built first and at the highest polish; the other
language packages mirror the same conceptual surface and are marked "coming
soon" until filled in. The TypeScript RDK depends on
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
| `nft` | optimistic | dedicated | celestia | 2,000 ms | standard | CosmWasm | 5,000 |
| `enterprise` | based | based | native | 1,000 ms | subsidized | EVM | 20,000 |
| `custom` | optimistic | dedicated | native | 1,000 ms | standard | EVM | 10,000 |

A QCAI-assisted `suggestProfile(useCase)` helper recommends a starting profile
from a plain-language description of your app, falling back to `defi` when the
advisory service is unavailable.

## Quickstart (TypeScript)

> The TypeScript package is in active development toward v0.1.0. The shape below
> reflects its public surface.

```sh
npm install @qorechain/rdk
```

```ts
import { createRdkClient, presets } from "@qorechain/rdk";

// Targets the public testnet (chain id "qorechain-diana") by default.
// Override endpoints to reach a real node.
const rdk = createRdkClient({
  endpoints: {
    rest: "https://rest.testnet.example",
    rpc: "https://rpc.testnet.example",
    evmRpc: "https://evm.testnet.example",
  },
});

// Read live module parameters from the chain (never hardcoded).
const params = await rdk.params();

// Start from a preset, then override fields as needed.
const config = presets.defi({ rollupId: "my-defi-rollup" });

// Validate against the compatibility matrix before submitting.
config.validate();
```

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live). The RDK defaults to testnet.
- Token: `QOR` (display) / `uqor` (base), 10^6 base units per QOR.
- Rollup creation requires a stake (default 10,000 QOR) and burns a small
  percentage on creation (default 1%). The kit reads the live values from the
  chain and shows the cost before you submit.

## License

Apache-2.0. See [LICENSE](./LICENSE).
