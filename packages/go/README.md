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
> [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk). Read paths and
> offline signing are unaffected; settlement-receipt verification needs a
> reachable node, because it checks the receipt against live chain state.

## What's new in 0.5.0

- **Settlement receipts are verified against the chain, never offline.** A
  receipt is a *claim*, not evidence: every field in it is supplied by whoever
  hands it to you. `VerifySettlementReceipt` now re-reads the claim from live
  chain state — the rollup's layer, the batch's state root, the anchor itself,
  and the creator's registered post-quantum key — and reports `Valid: true`
  (with `Mode: ReceiptModeChain`) only when the receipt reproduces what the
  chain holds. Without a client you can still check the signature against a key
  you obtained out-of-band, but that is `Mode: ReceiptModeSignatureOnly` and is
  **never** valid: a signature proves someone signed those bytes, not that
  QoreChain anchored anything. `ReceiptChecks` now reports
  `RollupLayerBinding`, `BatchStateRoot`, `AnchorOnChain`, `CreatorAuthority`
  and `PqcSignature`.

## What's new in 0.4.0

- **QCAI Rollup Copilot** — `GetRollupAdvice` aggregates a live fee estimate,
  network recommendations, fraud investigations, RL-agent status, and
  plain-language suggestions for a rollup (best-effort; unreachable advisory
  services degrade to warnings).
- **Quantum-safe settlement receipts** — `BuildSettlementReceipt` /
  `VerifySettlementReceipt`: a portable receipt that a settlement batch was
  anchored to the Main Chain under an ML-DSA-87 (Dilithium-5, FIPS-204)
  signature. The receipt is a claim; verification re-reads every field from live
  chain state before accepting it. The ML-DSA-87 verification uses the
  [`qorechain-pqc`](https://github.com/qorechain) library.

Install:

```sh
go get github.com/qorechain/qorechain-rdk/packages/go
```

Live broadcast requires a reachable node REST endpoint, and so does settlement-
receipt verification (it is checked against live chain state — a receipt on its
own proves nothing). Configuration, math, Merkle proofs and signing are usable
offline.

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
