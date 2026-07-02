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

> **Mainnet PQC signing requirement.** QoreChain mainnet requires the hybrid
> post-quantum signature extension (ML-DSA-87 + secp256k1) on native-lane
> transactions. The Python transaction path currently signs classical-only
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

```sh
pip install qorechain-rdk
```

> Install as `qorechain-rdk`; import as `qorrdk`.

```python
from qorrdk import presets, create_rdk_client, signer_from_env

# Build and validate a rollup configuration.
config = presets.defi("my-rollup").set(stake_amount_uqor="10000000000").build()

# Connect, sign, and broadcast (needs a reachable node endpoint).
client = create_rdk_client(network="testnet")
signer = signer_from_env()  # QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC
if signer is not None:
    tx = client.connect_tx(signer)
    tx.create_rollup(rollup_id="my-rollup", profile="defi", vm_type="evm",
                     stake_amount="10000000000")
```
