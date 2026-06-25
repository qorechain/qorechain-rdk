// Package rdk is the Go Rollup Development Kit for the QoreChain network.
//
// It mirrors the TypeScript RDK (@qorechain/rdk) and provides:
//
//   - Typed rollup configuration and a builder, with the settlement /
//     sequencer / proof / DA / gas / VM compatibility matrix validated
//     client-side (config.go, builder.go).
//   - The five preset profiles (defi, gaming, nft, enterprise, custom),
//     pre-filled with their documented defaults (presets.go).
//   - Exact denomination and economics math (math/big, no floating point),
//     bech32 <-> hex and byte helpers (utils.go, bech32.go).
//   - Binary Merkle proofs for assembling withdrawal proofs (merkle.go).
//   - A portable rollup manifest (manifest.go), native data-availability
//     helpers (da.go), event decoding (events.go), and the rollup /
//     settlement-batch lifecycles (lifecycle.go).
//   - REST and qor_ JSON-RPC read clients and a high-level RdkClient facade,
//     with an injectable HTTP doer for testing (client.go), plus preflight
//     (preflight.go), health (health.go), and faucet (faucet.go) helpers.
//   - HD account derivation (BIP-44 m/44'/118'/0'/0/0 secp256k1 -> bech32 qor),
//     hand-rolled Cosmos transaction encoding, signing, and broadcast, and an
//     RdkTxClient with lifecycle guards (accounts.go, messages.go, tx.go,
//     txclient.go).
//
// The constant and parameter values here are the network's documented defaults.
// They are NOT a substitute for live chain state: read the authoritative values
// with the rdk params query surface before acting on them.
package rdk
