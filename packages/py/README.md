# qorechain-rdk (Python)

Python Rollup Development Kit for the QoreChain network.

**Status: coming soon.** This package mirrors the conceptual surface of the
TypeScript RDK (`@qorechain/rdk`) — typed rollup configuration with the
compatibility matrix enforced, preset profiles, the rollup and settlement-batch
lifecycles, native data availability, and the read clients — and will be filled
in following the TypeScript reference implementation.

Planned surface (mirrors the TypeScript RDK modules):

- Typed rollup configuration and builder, with the settlement / sequencer /
  proof / DA / gas / VM compatibility matrix validated client-side.
- The five preset profiles: `defi`, `gaming`, `nft`, `enterprise`, `custom`.
- Lifecycle, settlement-batch, and native data-availability clients.
- Read clients for rollups, batches, and module parameters.

The enums and constants are stable today (`qorechain_rdk.enums`,
`qorechain_rdk.constants`); the client surface raises `NotImplementedError`
until released.

Planned install:

```sh
pip install qorechain-rdk
```
