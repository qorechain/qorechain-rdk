---
id: settlement-receipts
title: Quantum-safe settlement receipts
sidebar_position: 13
---

# Quantum-safe settlement receipts

A **settlement receipt** is a portable, self-contained proof that a rollup's
settlement batch was anchored to the Main Chain under a post-quantum signature.
It binds a specific batch to the on-chain anchor that committed the rollup's
state at that height, and it can be verified **fully offline** — no node, no
trust in the verifier's network path.

The anchor signature is **ML-DSA-87** (Dilithium-5, FIPS-204), the same
post-quantum scheme the Main Chain uses, so a receipt inherits the base chain's
quantum-safe integrity.

## The canonical anchor message

Verification checks a Dilithium-5 signature over a canonical message built from
the anchor fields, concatenated in this exact order:

```
layer_id || layer_height (8-byte big-endian) || state_root || validator_set_hash
```

`anchorSignBytes(...)` produces these bytes; the verifier reconstructs them from
the receipt and checks the signature against the layer creator's registered
ML-DSA-87 key.

## Build and verify (TypeScript)

```ts
import {
  createRdkClient,
  buildSettlementReceipt,
  verifySettlementReceipt,
} from "@qorechain/rdk";

const rdk = createRdkClient({
  endpoints: { rest: "https://api-testnet.qore.host" },
});

// Build a portable receipt for one batch.
const receipt = await buildSettlementReceipt(rdk, "my-roll", 7);

// Persist it, ship it, hand it to a counterparty — it is self-contained JSON.

// Verify fully offline. With no client, you must supply the creator's key.
const result = await verifySettlementReceipt(receipt, {
  creatorPublicKey: "<layer creator ML-DSA-87 public key>",
});

console.log(result.valid); // true when the signature and the batch↔anchor binding both hold
```

If you pass a `client` instead of (or alongside) `creatorPublicKey`, verification
fetches the layer creator's registered ML-DSA-87 key from the chain
(`getPqcAccount(address)`). Verification then checks two things:

1. the **Dilithium-5 signature** over the canonical anchor message, and
2. the **batch ↔ anchor state-root binding** — that the batch you hold is the one
   the anchor committed.

```ts
// Online verification: fetch the creator's PQC key from the chain.
const online = await verifySettlementReceipt(receipt, { client: rdk });
```

## Reading anchors

Receipts are built from a new on-chain `x/multilayer` **Anchor** query. The reads:

- `getAnchor(layerId)` — the anchor for a layer.
- `getLatestAnchor()` — the most recent anchor.
- `getAnchors(layerId)` — the anchor history for a layer.
- `getPqcAccount(address)` — a registered post-quantum account (its ML-DSA-87
  key), used to verify the creator's signature.

## CLI

```bash
# Build a receipt and print it.
qorollup receipt my-roll 7

# Build, then verify it inline.
qorollup receipt my-roll 7 --verify

# Build and write it to a file.
qorollup receipt my-roll 7 --out receipt.json
```

See the [qorollup reference](../reference/cli-qorollup.md).

## Other languages

The Python, Go, Rust, and Java (JVM) clients expose the same build/verify
surface. They perform the ML-DSA-87 verification through the
[`qorechain-pqc`](https://github.com/qorechain) library rather than a bundled
JavaScript implementation; install it alongside the RDK client for your
language.
