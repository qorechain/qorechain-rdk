# defi-rollup

A QoreChain DeFi rollup starter: **zk-SNARK settlement / dedicated sequencer /
native DA / EIP-1559 gas / EVM**, built on [`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).
Includes a reference SNARK prover.

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
pnpm submit-batch    # assemble a native DA blob + SNARK proof and submit a batch
```

## Reference SNARK prover

`src/prover.ts` produces the proof bytes for a settlement batch. The reference
Groth16 artifacts ship **checked in** under `circuits/artifacts/`, so out of the
box `pnpm submit-batch` generates and locally verifies a **real** Groth16 proof
with snarkjs before submitting it. (If the artifacts are ever missing it falls
back to a clearly-labeled placeholder so the create → submit → query flow still
runs.)

To rebuild the artifacts from the circuit (e.g. after editing
`circuits/multiplier.circom`), use the
[`circom`](https://docs.circom.io/getting-started/installation/) compiler:

```sh
pnpm circuit:build   # recompiles the circuit and refreshes circuits/artifacts/
```

> On-chain verification is what gates finalization. The exact proof encoding the
> network's SNARK verifier expects is defined by the chain — align `encodeProof`
> in `src/prover.ts` (and your own circuit) with it. The bundled `multiplier`
> circuit is an illustrative placeholder for your real state-transition circuit.

## Quantum-safe signing

`src/signer.ts` uses a standard secp256k1 signer. For hybrid post-quantum signing,
swap in [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s signer —
the RDK accepts any `@cosmjs` `OfflineSigner`.
