# qorechain-rdk (Go)

Go Rollup Development Kit for the QoreChain network.

**Status: available.** This package mirrors the TypeScript RDK
(`@qorechain/rdk`): typed rollup configuration with the compatibility matrix
enforced, preset profiles, the rollup and settlement-batch lifecycles, native
data availability, the read clients, and full transaction signing and broadcast.

Surface (mirrors the TypeScript RDK modules):

- Typed rollup configuration and builder, with the settlement / sequencer /
  proof / DA / gas / VM compatibility matrix validated client-side.
- The five preset profiles: `defi`, `gaming`, `nft`, `enterprise`, `custom`.
- Exact denomination and economics math (`math/big`, no floating point),
  bech32 <-> hex helpers, and binary Merkle withdrawal proofs.
- Rollup manifest, native data-availability helpers, and event decoding.
- REST and `qor_` JSON-RPC read clients and a high-level `RdkClient` facade,
  with an injectable HTTP client for testing, plus preflight, health, and
  faucet helpers.
- HD account derivation (BIP-44 `m/44'/118'/0'/0/0` secp256k1 -> bech32 `qor`),
  hand-rolled Cosmos transaction encoding, signing, and broadcast via an
  `RdkTxClient` with lifecycle guards.

> **Mainnet PQC signing requirement.** QoreChain mainnet requires the hybrid
> post-quantum signature extension (ML-DSA-87 + secp256k1) on native-lane
> transactions. The Go transaction path currently signs classical-only
> (SIGN_MODE_DIRECT, secp256k1), so native-lane broadcasts to mainnet will be
> rejected — use it on permissive networks (testnet, local devnets) or pair it
> with the [`qorechain-pqc`](https://github.com/qorechain/qorechain-pqc)
> bindings in a custom backend. The TypeScript RDK supports hybrid signing via
> [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk). Read paths,
> offline signing, and settlement-receipt verification are unaffected.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `GetRollupAdvice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `BuildSettlementReceipt` /
  `VerifySettlementReceipt`: a portable receipt proving a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature, verifiable fully offline. The ML-DSA-87 verification uses the
  [`qorechain-pqc`](https://github.com/qorechain) library.

Install:

```sh
go get github.com/qorechain/qorechain-rdk/packages/go
```

Live broadcast requires a reachable node REST endpoint; the read clients and
all signing are usable offline (the broadcast call is the only step that needs
a node).

## Example

```go
package main

import (
	"context"
	"fmt"

	rdk "github.com/qorechain/qorechain-rdk/packages/go"
)

func main() {
	// Build and validate a rollup configuration from a preset.
	cfg, err := rdk.PresetDefi().
		SetRollupID("my-defi-rollup").
		SetStakeAmountUqor("10000000000").
		Build()
	if err != nil {
		panic(err)
	}

	// Derive a native account and connect a client.
	acc, _ := rdk.DeriveNativeAccount(mnemonic, 0)
	client := rdk.NewRdkClient(rdk.RdkClientOptions{Network: "testnet"})
	params, _ := client.Params(context.Background())
	fmt.Println(params.MinStakeForRollup)

	// Sign a create-rollup transaction (broadcast needs a live node).
	tx := rdk.NewRdkTxClient(acc, client.Network.ChainID, client.Rest)
	msg := tx.CreateRollup(rdk.CreateRollupInput{
		RollupID: cfg.RollupID, Profile: string(cfg.Profile),
		VmType: string(cfg.VmType), StakeAmount: 10000000000,
	})
	_ = msg
}
```
