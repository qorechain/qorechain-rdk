# nft-rollup

A QoreChain NFT rollup starter: **optimistic settlement / dedicated sequencer /
Celestia DA / standard gas / CosmWasm VM**, built on
[`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).

Optimistic settlement with a CosmWasm execution layer — a natural fit for NFT
collections and marketplaces that want low fees and smart-contract flexibility.

## Prerequisites

- Node.js >= 20.
- A funded operator account on your target network (creating a rollup requires a
  stake and burns a small percentage on creation — the `create` script prints the
  live amounts before submitting).
- Node endpoint URLs.

## Setup

```sh
pnpm install        # or npm install / yarn
cp .env.example .env
```

Edit `.env`: set `QORE_NETWORK`, the `QORE_*_URL` endpoints, and your operator key
(`QORE_OPERATOR_PRIVATE_KEY_HEX` or `QORE_MNEMONIC`). Never commit `.env`.

## Scripts

```sh
pnpm create          # validate the config, show the cost, and create the rollup
pnpm query-status    # read the rollup config and its latest settlement batch
pnpm submit-batch    # assemble a DA blob and submit an optimistic batch
pnpm challenge       # raise a fraud-proof challenge against a batch
```

## Operate

```sh
pnpm doctor          # preflight: endpoints, network, config, signer, balance
pnpm status          # rollup health: status, latest batch, challenge window
```

`pnpm doctor` is a good first run — it verifies your `.env` is ready before you
`pnpm create`. The standalone operator CLI `npx @qorechain/rdk-cli` (`qorollup`)
does the same checks plus `watch`, `pause`, `resume`, and `stop` for a live rollup.

## Celestia DA — planned, not yet available

This profile selects **Celestia** as its data-availability backend. Celestia DA
is **planned / not yet available on the network**: it is selectable in the
configuration, but the network does not yet serve it. Until it ships, post batch
data with the **native** DA backend.

`src/submit-batch.ts` builds the DA blob with `buildDaBlob` for native DA and
guards the choice with `isDaBackendAvailable` / `assertDaBackendAvailable` —
`assertDaBackendAvailable("celestia")` throws a clear "planned / not yet
available" error today, while `"native"` passes. When Celestia is enabled, switch
the blob path over.

## Optimistic challenge flow

Optimistic settlement carries the **`fraud`** proof system (enforced by the
compatibility matrix on `.validate()` / `.build()`). A submitted batch is
presumed valid and finalizes after its challenge window elapses, unless someone
disputes it:

1. `pnpm submit-batch` posts a batch optimistically (no validity proof).
2. During the challenge window, a challenger calls
   `tx.challengeBatch({ rollupId, batchIndex, proof })` with a fraud proof and a
   bond — see `src/challenge.ts` (it uses a clearly-labeled placeholder proof).
3. A resolver closes it with
   `tx.resolveChallenge({ rollupId, batchIndex, fraudUpheld })`:
   - `fraudUpheld: true` rejects the batch and awards the bond;
   - `fraudUpheld: false` dismisses the challenge and the batch proceeds.

The exact fraud-proof encoding is defined by the network's verifier — replace the
placeholder in `src/challenge.ts` before any live use.

## Quantum-safe signing

`src/signer.ts` uses a standard secp256k1 signer. For hybrid post-quantum signing,
swap in [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s signer —
the RDK accepts any `@cosmjs` `OfflineSigner`.
