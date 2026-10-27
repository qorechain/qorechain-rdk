# qorechain-rdk (Python)

Python Rollup Development Kit for the QoreChain network.

**Status: Available.** This package mirrors the TypeScript RDK
(`@qorechain/rdk`) with idiomatic, type-hinted, snake_case Python — typed rollup
configuration with the compatibility matrix enforced, preset profiles, the
rollup and settlement-batch lifecycles, native data availability, transaction
signing and broadcast, and the read clients.

Surface (mirrors the TypeScript RDK modules):

- Typed rollup configuration and builder, with the settlement / sequencer /
  proof / DA / gas / VM compatibility matrix validated client-side.
- The five preset profiles: `defi`, `gaming`, `nft`, `enterprise`, `custom`.
- Exact denom conversion and creation-cost economics (integer math, no float).
- Binary-Merkle withdrawal-proof assembly for the bridge.
- Portable rollup manifests (save / share / reload).
- Account derivation from a BIP-39 mnemonic (BIP-44 `m/44'/118'/0'/0/0`,
  secp256k1, bech32 `qor`) and a SIGN_MODE_DIRECT signer.
- Hand-encoded protobuf codecs for the eight `rdk` messages, a full transaction
  builder, and broadcast via the REST `/cosmos/tx/v1beta1/txs` endpoint.
- Read clients: REST (LCD), the `qor_` JSON-RPC namespace, typed views, and the
  `RdkClient` facade — plus preflight ("doctor"), rollup health, event decoding,
  and a faucet helper. Live broadcast requires a reachable node endpoint; the
  HTTP transport is injectable for testing.

> **Post-quantum (hybrid) signing.** Both QoreChain networks require the hybrid
> post-quantum signature (ML-DSA-87 + secp256k1) on native-lane transactions.
> Give the tx client a PQC keypair and every transaction it signs is hybrid,
> built by the QoreChain Python SDK
> ([`qorechain-sdk`](https://github.com/qorechain/qorechain-sdk), `qorsdk`).
> Without one it signs classical-only (SIGN_MODE_DIRECT, secp256k1), and the
> networks refuse the transaction. Read paths, local transaction building, and
> settlement-receipt verification (which reads live chain state) need no PQC key.

```python
from qorrdk import create_rdk_client, pqc_keypair_from_env, signer_from_env

client = create_rdk_client(network="testnet")
signer = signer_from_env()  # QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC
# QORE_PQC_SEED_HEX (a 32-byte ML-DSA-87 seed) or QORE_MNEMONIC, checked
# against the key the chain holds for this account.
pqc = pqc_keypair_from_env(client, signer.address)
tx = client.connect_tx(
    signer,
    pqc_keypair=pqc.keypair,
    include_pqc_public_key=pqc.include_pqc_public_key,  # True: registers the key on first use
    sign_bytes_version="auto",  # or force "v1" / "v2"
)
tx.pause_rollup(rollup_id="my-rollup", reason="maintenance")
```

`pqc_keypair_from_env` (and `resolve_pqc_keypair(client, address, mnemonic)`)
pick the key the chain actually has registered for the account: the canonical
address-bound derivation (`shake256("qorechain:pqc:v1|" + address + "|" +
mnemonic)`) or the legacy one. An account with no key yet gets the canonical
key, embedded in the first transaction so the chain registers it. A key on
chain that neither derivation (nor `QORE_PQC_SEED_HEX`) produces is an error,
never a guess. With `sign_bytes_version="auto"` the client asks the network's
REST endpoint which hybrid sign-bytes form it verifies (`v1` / `v2`); a direct
`RdkTxClient(...)` takes the same `pqc_keypair`, `include_pqc_public_key` and
`sign_bytes_version` keyword arguments.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `get_rollup_advice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `build_settlement_receipt` /
  `verify_settlement_receipt`: a portable record that a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature. A receipt is a **claim, not evidence** — every field in it comes
  from whoever handed it to you — so `verify_settlement_receipt` requires a
  `client` and re-reads the rollup's layer, the batch's state root, the anchor
  and the creator's registered key from **live chain state**; only then does it
  return `valid=True` with `mode="chain"`. There is no offline verification:
  without a client you get `mode="signature-only"`, which proves someone signed
  those bytes and is never `valid`. The ML-DSA-87 verification uses the
  [`qorechain-pqc`](https://github.com/qorechain) library.

```sh
pip install qorechain-rdk
```

> Install as `qorechain-rdk`; import as `qorrdk`.

```python
from qorrdk import presets, create_rdk_client, pqc_keypair_from_env, signer_from_env

# Build and validate a rollup configuration.
config = presets.defi("my-rollup").set(stake_amount_uqor="10000000000").build()

# Connect, sign hybrid, and broadcast (needs a reachable node endpoint).
client = create_rdk_client(network="testnet")
signer = signer_from_env()  # QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC
pqc = pqc_keypair_from_env(client, signer.address) if signer else None
if signer is not None and pqc is not None:
    tx = client.connect_tx(signer, pqc_keypair=pqc.keypair,
                           include_pqc_public_key=pqc.include_pqc_public_key)
    tx.create_rollup(rollup_id="my-rollup", profile="defi", vm_type="evm",
                     stake_amount="10000000000")
```
