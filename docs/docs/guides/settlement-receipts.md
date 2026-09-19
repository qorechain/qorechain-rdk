---
id: settlement-receipts
title: Quantum-safe settlement receipts
sidebar_position: 13
---

# Quantum-safe settlement receipts

A **settlement receipt** is a portable record that a rollup's settlement batch
was anchored to the Main Chain under a post-quantum signature. You can persist
it, ship it, and hand it to an auditor or counterparty.

:::caution A receipt is a claim, not evidence
Every field in a receipt comes from whoever handed it to you — including the
signature and the key it names. Verifying it therefore means **re-reading the
claim from the chain**: `verifySettlementReceipt` only reports `valid: true`
when the receipt reproduces what the chain actually holds. A receipt checked
against nothing but itself proves nothing.
:::

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

// Verify it: pass a client so every field is re-read from chain state.
const result = await verifySettlementReceipt(receipt, { client: rdk });

console.log(result.valid); // true only when the chain confirms the receipt
console.log(result.mode);  // "chain"
```

Verification against a `client` checks **five** things, each read from the chain
rather than from the receipt:

1. **`rollupLayerBinding`** — the chain says this rollup belongs to that layer.
2. **`batchStateRoot`** — the chain's batch carries the receipt's state root.
3. **`anchorOnChain`** — an anchor with this state root, height, validator-set
   hash and signature **actually exists on chain**.
4. **`creatorAuthority`** — the signing key is resolved from the chain for the
   rollup's registered creator, never taken from the receipt.
5. **`pqcSignature`** — the Dilithium-5 signature over the canonical anchor
   message verifies under that key.

### Signature-only mode

Without a `client` you can still check the signature against a key you obtained
out-of-band. This is `mode: "signature-only"` and is **never `valid`** by
design — it shows someone signed those bytes, not that QoreChain anchored
anything:

```ts
const sigOnly = await verifySettlementReceipt(receipt, {
  creatorPublicKey: "<a key you obtained out-of-band>",
});
// sigOnly.mode  === "signature-only"
// sigOnly.valid === false
```

:::note Your trust anchor is the node you query
Chain verification is only as good as the endpoint you point at. Use a node you
run or trust; a hostile endpoint can answer whatever it likes.
:::

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

# Verify a receipt SOMEBODY GAVE YOU (the relying-party path).
qorollup receipt verify receipt.json
```

`--verify` self-checks a receipt this command just built. To check a receipt you
received from someone else, use `qorollup receipt verify <file>` — it verifies
exactly what was presented to you, without rebuilding it.

See the [qorollup reference](../reference/cli-qorollup.md).

## What a receipt does not prove

Verification tells you that the chain holds what the receipt claims. Two limits
are worth stating plainly, because a receipt is most often shown to someone who
was not there when it was made.

**Your trust anchor is the node you query.** Every check is a read against one
endpoint. A receipt verified against a node the presenter chose proves only what
that node says. Verify against a node you control, or one you would trust for a
balance.

**The anchor signature does not name the rollup or the batch.** The canonical
message covers `layer_id`, `layer_height`, `state_root` and
`validator_set_hash` — nothing identifies *which* rollup or *which* batch
produced that state root, because an anchor is a layer-level object. Verification
compensates by binding the receipt's `rollupId` and `batchIndex` through chain
reads: the chain's batch at that index must carry exactly that state root, and
the rollup must sit on that layer. So a receipt can never assert a state root the
chain does not hold for that batch.

What remains is narrow but real: where two batches genuinely share the same state
root, on the same layer, under the same creator — two freshly created rollups, or
a batch that changed no state — a genuine anchor and its signature can be
relabelled from one to the other and the receipt still verifies. Closing this
requires the anchor message itself to commit to the rollup and batch, which is a
chain-side change, not something the toolkit can do on its own. Until then, treat
a receipt as evidence that *this state root* is anchored on *this layer*, and
rely on the chain reads — not the signature — for which batch it belongs to.

## Other languages

The Python, Go, Rust, and Java (JVM) clients expose the same build/verify
surface. They perform the ML-DSA-87 verification through the
[`qorechain-pqc`](https://github.com/qorechain) library rather than a bundled
JavaScript implementation; install it alongside the RDK client for your
language.
