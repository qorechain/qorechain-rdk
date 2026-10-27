# defi-rollup

A QoreChain DeFi rollup starter: **zk-SNARK settlement / dedicated sequencer /
native DA / EIP-1559 gas / EVM**, built on [`@qorechain/rdk`](https://github.com/qorechain/qorechain-rdk).
Includes a reference SNARK prover.

> **ZK settlement cannot be used on QoreChain yet.** The chain checks a zk
> batch's proof when the batch is submitted, against a verification key
> registered on the rollup, and no chain release up to v3.2.5 has a way to
> register one: every zk batch is refused (code 21) after its fee is paid. Key
> registration is planned for chain v3.2.7. Until then `pnpm create` works, and
> `pnpm submit-batch` stops before sending anything.

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
pnpm submit-batch    # submit a batch with a SNARK proof
```

## Operate

```sh
pnpm doctor          # preflight: endpoints, network, config, signer, balance
pnpm status          # rollup health: status, latest batch, challenge window
```

`pnpm doctor` is a good first run — it verifies your `.env` is ready before you
`pnpm create`. The standalone operator CLI `npx @qorechain/rdk-cli` (`qorollup`)
does the same checks plus `watch`, `pause`, `resume`, and `stop` for a live rollup.

## Reference SNARK prover

`src/prover.ts` produces proof bytes from a tiny demo circuit
(`circuits/multiplier.circom`, built with snarkjs; the artifacts are checked in
under `circuits/artifacts/`, rebuild with `pnpm circuit:build` and the
[`circom`](https://docs.circom.io/getting-started/installation/) compiler). It
shows where a prover plugs in; it is not a proof the chain can accept. The
chain verifies **Groth16 over BLS12-381** in gnark's binary encoding, against
the rollup's registered key, with these public inputs, each a big-endian
integer reduced into the scalar field:

1. `prev_state_root`
2. `state_root`
3. `data_hash`
4. `withdrawals_root` (for batches submitted from chain v3.2.5; earlier batches
   have only the first three)

A real circuit for your state transition must take exactly those inputs.

## Quantum-safe signing

Both QoreChain networks require a **hybrid** signature on native-lane
transactions — an ML-DSA-87 (Dilithium-5) signature alongside the classical
secp256k1 one — and refuse a classical-only transaction. Every script here
connects through `connectOperator()` in `src/signer.ts`, which signs hybrid.

You do not configure the post-quantum key directly in most cases:

- **With `QORE_MNEMONIC`**, the RDK derives the key for you. A mnemonic can
  yield two post-quantum keys (canonical and legacy), and a wallet may have
  registered either; the RDK reads which one your account holds on chain and
  uses that. An account with no key yet registers the canonical one on its first
  transaction.
- **With `QORE_OPERATOR_PRIVATE_KEY_HEX`**, there is no mnemonic to derive
  from, so also set `QORE_PQC_SEED_HEX` to your 32-byte ML-DSA-87 seed.

Either way the key is checked against the chain before anything is signed: if
your account holds a different post-quantum key, the script stops with a clear
error instead of paying for a transaction that would be refused.
