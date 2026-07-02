# qorechain-rdk (Rust)

Rust Rollup Development Kit for the QoreChain network.

**Status: Available.** This crate mirrors the TypeScript RDK (`@qorechain/rdk`):
typed rollup configuration with the compatibility matrix enforced client-side,
the five preset profiles, denom and economics helpers, binary Merkle withdrawal
proofs, a portable rollup manifest, read clients over REST and the `qor_`
JSON-RPC namespace, preflight/health/event helpers, account derivation, and a
signing transaction client. Live broadcast needs a reachable node.

Surface (mirrors the TypeScript RDK modules):

- Typed rollup configuration and builder, with the settlement / sequencer /
  proof / DA / gas / VM compatibility matrix validated client-side.
- The five preset profiles: `defi`, `gaming`, `nft`, `enterprise`, `custom`.
- Denomination (`qor_to_uqor` / `uqor_to_qor`) and rollup-creation economics,
  using exact integer math.
- Binary Merkle withdrawal-proof assembly for `MsgExecuteWithdrawal`.
- Read clients for rollups, batches, and module parameters (REST + `qor_`
  JSON-RPC) over an injectable, mockable transport.
- Account derivation (mnemonic → secp256k1 → bech32 `qor` address) and a signing
  transaction client that builds SIGN_MODE_DIRECT transactions for the eight
  `rdk` messages and broadcasts them over REST.

> **Mainnet PQC signing requirement.** QoreChain mainnet requires the hybrid
> post-quantum signature extension (ML-DSA-87 + secp256k1) on native-lane
> transactions. The Rust transaction path currently signs classical-only
> (SIGN_MODE_DIRECT, secp256k1), so native-lane broadcasts to mainnet will be
> rejected — use it on permissive networks (testnet, local devnets) or pair it
> with the [`qorechain-pqc`](https://github.com/qorechain/qorechain-pqc)
> bindings in a custom backend. The TypeScript RDK supports hybrid signing via
> [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk). Read paths,
> offline signing, and settlement-receipt verification are unaffected.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `get_rollup_advice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `build_settlement_receipt` /
  `verify_settlement_receipt`: a portable receipt proving a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature, verifiable fully offline. The ML-DSA-87 verification uses the
  [`qorechain-pqc`](https://github.com/qorechain) library.

## Install

```sh
cargo add qorechain-rdk
```

## Example

```rust
use qorechain_rdk::presets::preset;
use qorechain_rdk::config::Profile;

let config = preset(Profile::Defi)
    .set_rollup_id("my-defi-rollup")
    .build()
    .expect("valid config");
assert_eq!(config.profile, Profile::Defi);
```

To create and broadcast a rollup, derive an account, point a `RdkTxClient` at a
node's REST endpoint, and call `create_rollup` (read the live account
number/sequence and minimum stake from the chain first).
