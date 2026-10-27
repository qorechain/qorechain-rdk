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
  transaction signing and broadcast via an `RdkTxClient` with lifecycle guards:
  hybrid (post-quantum) through the QoreChain SDK when given a post-quantum
  keypair, classical otherwise.

## Hybrid (post-quantum) signing

Both QoreChain networks require the hybrid post-quantum signature (ML-DSA-87 +
secp256k1) on native-lane transactions and refuse a classical-only one. Give the
tx client a post-quantum keypair and every transaction it signs is built by the
[QoreChain SDK](https://github.com/qorechain/qorechain-sdk)'s hybrid builder,
which attaches the ML-DSA-87 signature as a tx-body extension alongside the
classical signature:

```go
client := rdk.NewRdkClient(rdk.RdkClientOptions{Network: "testnet"})
acc, _ := rdk.DeriveNativeAccount(mnemonic, 0)

// Find the post-quantum key the account actually uses, by asking the chain.
resolved, err := rdk.ResolvePqcKeypair(ctx, client, acc.Address, mnemonic)
if err != nil {
	panic(err)
}
opts := resolved.HybridOptions()
tx := client.ConnectTx(acc, &opts) // or rdk.NewRdkTxClient(...).WithHybrid(opts)
```

`ResolvePqcKeypair` derives both keys a mnemonic can yield (the canonical,
address-bound one and the legacy one) and returns whichever the chain has
registered. An account with no key yet gets the canonical key with
`IncludePqcPublicKey` set, so its first transaction registers it; a key that
neither derivation produces is an error. From the environment:

```go
resolved, ok, err := rdk.PqcKeypairFromEnv(ctx, client, acc.Address, env)
```

reads `QORE_PQC_SEED_HEX` (a 32-byte ML-DSA-87 seed, checked against the
registered key) or else `QORE_MNEMONIC`; `ok` is false when neither is set.

The sign-bytes form (v1 or v2, by the chain's applied upgrade) is chosen
automatically over the client's REST endpoint; set
`HybridOptions.SignBytesVersion` to `rdk.SignBytesV1` / `rdk.SignBytesV2` to
force one. `BuildTx` builds and signs without broadcasting.

Without a post-quantum keypair the client signs classical-only
(SIGN_MODE_DIRECT, secp256k1), and the networks refuse the transaction. That
path stays for offline use and local chains. Read paths are unaffected;
settlement-receipt verification needs a reachable node, because it checks the
receipt against live chain state.

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
	ctx := context.Background()
	acc, _ := rdk.DeriveNativeAccount(mnemonic, 0)
	client := rdk.NewRdkClient(rdk.RdkClientOptions{Network: "testnet"})
	params, _ := client.Params(ctx)
	fmt.Println(params.MinStakeForRollup)

	// Connect a hybrid (post-quantum) signing client.
	resolved, err := rdk.ResolvePqcKeypair(ctx, client, acc.Address, mnemonic)
	if err != nil {
		panic(err)
	}
	opts := resolved.HybridOptions()
	tx := client.ConnectTx(acc, &opts)

	// Build a create-rollup message and sign it (broadcast needs a live node
	// and the account's number and sequence).
	msg := tx.CreateRollup(rdk.CreateRollupInput{
		RollupID: cfg.RollupID, Profile: string(cfg.Profile),
		VmType: string(cfg.VmType), StakeAmount: 10000000000,
	})
	fee := rdk.Fee{Amount: []rdk.Coin{{Denom: "uqor", Amount: "30000"}}, GasLimit: 200000}
	txParams := rdk.TxParams{Fee: fee, AccountNumber: 7, Sequence: 0}
	built, err := tx.BuildTx(ctx, []rdk.Msg{msg}, txParams)
	if err != nil {
		panic(err)
	}
	_ = built.TxRaw // or tx.Broadcast(ctx, []rdk.Msg{msg}, txParams)
}
```
