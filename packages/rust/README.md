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
  transaction client that builds transactions for the eight `rdk` messages and
  broadcasts them over REST, signed hybrid (post-quantum) when given an
  ML-DSA-87 keypair.

> **Post-quantum signing.** Both QoreChain networks require the hybrid
> post-quantum signature (ML-DSA-87 + secp256k1) on native-lane transactions.
> Give `RdkTxClient` a PQC keypair and every transaction it signs is built with
> the [`qorechain-sdk`](https://crates.io/crates/qorechain-sdk) hybrid builder.
> **Without one it signs classical-only (SIGN_MODE_DIRECT, secp256k1), and the
> networks refuse the transaction.** Read paths and settlement-receipt
> verification are unaffected.

## Hybrid (post-quantum) signing

Find the ML-DSA-87 keypair the account actually uses, then pass it to the tx
client:

```rust,no_run
use qorechain_rdk::accounts::{pqc_keypair_from_env, resolve_pqc_keypair, NativeAccount};
use qorechain_rdk::client::RdkClient;
use qorechain_rdk::tx::{HybridSigningOptions, RdkTxClient, TxOptions};

let mnemonic = std::env::var("QORE_MNEMONIC").unwrap();
let account = NativeAccount::from_mnemonic_default(&mnemonic).unwrap();
let client = RdkClient::testnet();

// From a mnemonic: the canonical or legacy key, whichever the chain holds.
let resolved = resolve_pqc_keypair(&client, account.address(), &mnemonic).unwrap();
// Or from the environment: QORE_PQC_SEED_HEX (a 32-byte seed), else QORE_MNEMONIC.
// let resolved = pqc_keypair_from_env(&client, account.address()).unwrap().expect("a PQC key");

let tx = RdkTxClient::new_with_options(
    account,
    client.rest.clone(),
    "qorechain-diana",
    account_number, // read from /cosmos/auth/v1beta1/accounts/{address}
    sequence,
    HybridSigningOptions::from(resolved),
)
.unwrap();
tx.pause_rollup("my-rollup", "maintenance", None, &TxOptions::default()).unwrap();
```

- `resolve_pqc_keypair(client, address, mnemonic)` reads the account's
  registered key (`/qorechain/pqc/v1/account/{address}`). No key registered: the
  canonical key (`shake256("qorechain:pqc:v1|" + address + "|" + mnemonic)`),
  with `include_pqc_public_key: true` so the first transaction registers it.
  Registered canonical or legacy key: that key, not embedded. Any other key is
  an error: it was registered from another secret.
- `pqc_keypair_from_env(client, address)` uses `QORE_PQC_SEED_HEX` (a 32-byte
  ML-DSA-87 seed, for an operator who signs with
  `QORE_OPERATOR_PRIVATE_KEY_HEX`; it must match the registered key, if any),
  otherwise `QORE_MNEMONIC`, otherwise returns `None`.
- `HybridSigningOptions` takes `pqc_keypair`, `include_pqc_public_key`, and
  `sign_bytes_version`: `SignBytesMode::Auto` (the default) asks the node over
  REST which hybrid sign-bytes form it verifies (v1 or v2, by the chain's
  applied upgrade) and, if a broadcast is refused for the hybrid signature,
  asks again and re-signs once; `SignBytesMode::V1` / `V2` force a form.
- `build_hybrid_tx(msg, opts, version)` builds without broadcasting and returns
  the `TxRaw` bytes plus the exact bytes the ML-DSA-87 signature covers.

## What's new in 0.5.0

- **Settlement-receipt verification is against live chain state** (security fix,
  breaking). A receipt is a **claim, not evidence** — every field in it is
  supplied by whoever hands it to you. `verify_settlement_receipt` now re-reads
  the claim from the chain (the rollup's layer, the batch's state root, the
  anchor itself, and the creator's registered key) and reports `valid: true`
  only when the receipt reproduces what the chain holds. The result gains
  `mode: ReceiptVerificationMode` (`"chain"` / `"signature-only"`), and `checks`
  is replaced by `rollup_layer_binding`, `batch_state_root`, `anchor_on_chain`,
  `creator_authority` and `pqc_signature` (the old `state_root_binding` and
  `has_material` are gone).
- Passing only `creator_public_key_hex`, with no client, is now
  `mode: "signature-only"` and **never** `valid`: it shows that someone signed
  those bytes, not that QoreChain anchored the batch. Code that relied on
  offline verification returning `valid: true` must pass a client.
- `SettlementReceipt::batch_state_root` is kept, but is **informational only** —
  verification compares the receipt against the chain's batch, never against the
  receipt's own copy of it.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `get_rollup_advice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `build_settlement_receipt` /
  `verify_settlement_receipt`: a portable receipt that a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature. Verification is against live chain state — see 0.5.0 above; the
  ML-DSA-87 verification uses the
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
