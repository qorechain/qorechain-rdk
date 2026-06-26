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
