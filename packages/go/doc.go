// Package rdk is the Go Rollup Development Kit for the QoreChain network.
//
// Status: coming soon. This package mirrors the conceptual surface of the
// TypeScript RDK (@qorechain/rdk). The enum and constant values defined here
// are stable today; the client surface is not shipped yet and will be filled
// in following the TypeScript reference implementation.
//
// Planned surface:
//
//   - Typed rollup configuration and a builder, with the settlement /
//     sequencer / proof / DA / gas / VM compatibility matrix validated
//     client-side.
//   - The five preset profiles (defi, gaming, nft, enterprise, custom),
//     pre-filled with their documented defaults.
//   - Lifecycle, settlement-batch, and native data-availability clients.
//   - Read clients for rollups, batches, and module parameters.
package rdk
