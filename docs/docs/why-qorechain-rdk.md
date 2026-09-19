---
id: why-qorechain-rdk
title: Why QoreChain RDK
sidebar_position: 2
slug: /why
---

# Why QoreChain RDK

Most rollup development kits are variations on the same theme: they help you
launch an app-chain that settles to a base layer. The QoreChain RDK does that
too — but it also exposes three things **no other rollup kit can**, because they
depend on capabilities that live in QoreChain's Layer 1, not in the tooling:

- a **post-quantum** settlement layer,
- **on-chain AI/RL** advisory primitives (QCAI), and
- a **triple-VM** runtime with cross-VM calls.

If you only need a generic optimistic/zk rollup, any kit will do. If you want
your rollup's settlement to be **verifiable, quantum-safe, and AI-aware**, this
is the only kit that can express it — in TypeScript, Python, Go, Rust, and Java.

| Differentiator | Status | Why it's only possible here |
| --- | --- | --- |
| **Quantum-safe settlement receipts** | 🟢 Unique (first-mover) | Needs a post-quantum L1 — impossible on a non-PQC base layer |
| **QCAI Rollup Copilot** | 🟢 Unique through the chain | Wraps QoreChain-only on-chain AI/RL endpoints |
| **Multi-VM cross-VM calls** | 🟡 Distinctive | QoreChain runs EVM + QoreChain Native + SVM under one chain |

---

## 1. Quantum-safe settlement receipts

> 🟢 **Unique.** No rollup kit built on a non-post-quantum L1 can offer this.

When your rollup anchors a settlement batch, QoreChain commits its state root to
the Main Chain under a **post-quantum (ML-DSA-87 / Dilithium-5, FIPS-204)**
signature. The RDK turns that anchor into a **portable receipt** you can hand to
an auditor, an exchange, or a counterparty.

A receipt is a **claim, not evidence** — every field in it comes from whoever
handed it to you. So verification re-reads the claim from the chain: that the
rollup really belongs to that layer, that the batch really carries that state
root, that **an anchor matching the receipt actually exists on chain**, and that
the creator's key is the one the chain has registered. Only then is it valid.
The signature itself covers the canonical message
`layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash`.

```ts
import {
  createRdkClient,
  buildSettlementReceipt,
  verifySettlementReceipt,
} from "@qorechain/rdk";

const rdk = createRdkClient({
  network: "mainnet",
  endpoints: { rest: "https://api.qore.host" }, // QoreChain mainnet REST
});

// Build a portable receipt for batch #42 of "my-rollup".
const receipt = await buildSettlementReceipt(rdk, "my-rollup", 42);
// → { algorithm: "ML-DSA-87", stateRoot, layerHeight, pqcSignature, creator, ... }

// Verify it — fetches the creator's PQC key from the chain.
const result = await verifySettlementReceipt(receipt, { client: rdk });
console.log(result.valid);                 // true
console.log(result.checks.pqcSignature);   // Dilithium-5 signature verified
console.log(result.checks.stateRootBinding); // batch root == anchored root
```

There is also a **signature-only** mode, for when you only want to check the
post-quantum signature against a key you already hold. It is deliberately never
`valid` — a signature proves someone signed those bytes, it cannot prove the
anchor exists:

```ts
const result = await verifySettlementReceipt(receipt, {
  creatorPublicKey: "a1b2…", // a key you obtained out-of-band
});
// result.mode  === "signature-only"
// result.valid === false      ← by design: nothing was checked against the chain
```

The same receipt verifies **byte-for-byte across all five languages** (the
non-TypeScript clients use the chain's own `qorechain-pqc` library), so a receipt
produced by a TypeScript service verifies identically in a Go auditor or a Java
backend. See [Quantum-safe settlement receipts](guides/settlement-receipts.md).

---

## 2. QCAI Rollup Copilot

> 🟢 **Unique through the chain.** Built on on-chain AI/RL endpoints that other
> networks simply don't have.

QoreChain runs network-level AI/RL services on-chain — a fee-policy agent, network
recommendations, fraud investigations, circuit breakers. The Copilot aggregates
them into a single, reviewable, plain-language view for one rollup. It's
read-only and best-effort: if an advisory service is unreachable, it degrades to
a warning instead of failing.

```ts
import { createRdkClient, getRollupAdvice } from "@qorechain/rdk";

const rdk = createRdkClient({ network: "mainnet", endpoints: { rest, evmRpc } });

const advice = await getRollupAdvice(rdk, "my-rollup");

for (const s of advice.suggestions) {
  console.log(`[${s.level}] ${s.message}`);
  // [action] 2 open fraud investigation(s) reference this rollup …
  // [warn]   QCAI reports network congestion — consider raising the fee …
  // [info]   A live QCAI fee estimate is available …
}

console.log(advice.feeEstimate);          // live QCAI fee estimate
console.log(advice.fraudInvestigations);  // investigations touching this rollup
console.log(advice.rlAgentStatus);        // the RL fee/routing agent's state
```

From the CLI:

```bash
qorollup advise my-rollup
```

Other kits have nothing to wrap — the advisory data is a QoreChain primitive.
See [QCAI Copilot](guides/qcai-copilot.md).

---

## 3. Multi-VM cross-VM calls

> 🟡 **Distinctive.** QoreChain runs EVM, QoreChain Native, and SVM under one chain, with
> a precompile that bridges EVM → QoreChain Native.

Your EVM (Solidity) rollup contract can call an existing **QoreChain Native (Wasm)** contract
through a fixed precompile at `0x…0901`. The RDK builds the calldata for you, so
you can reuse a QoreChain Native oracle, token, or registry from Solidity without
re-implementing it.

```ts
import { encodeCrossVmCalldata, CROSS_VM_PRECOMPILE } from "@qorechain/rdk";

const calldata = encodeCrossVmCalldata({
  contract: "qor1examplecontract…",       // target QoreChain Native (Wasm) contract
  msg: JSON.stringify({ increment: {} }),  // its execute message
});

// Send an EVM transaction:  to = CROSS_VM_PRECOMPILE,  data = calldata
console.log(CROSS_VM_PRECOMPILE); // 0x0000000000000000000000000000000000000901
```

Or directly from Solidity on your rollup:

```solidity
address constant CROSS_VM_PRECOMPILE = 0x0000000000000000000000000000000000000901;

function callNative(string calldata contractAddr, bytes calldata msg_)
    external returns (bytes memory)
{
    bytes memory data =
        abi.encodeWithSignature("executeCrossVMCall(string,bytes)", contractAddr, msg_);
    (bool ok, bytes memory ret) = CROSS_VM_PRECOMPILE.call(data);
    require(ok, "cross-VM call failed");
    return ret;
}
```

Scaffold a starter with `npm create qorechain-rollup my-app -- --template multivm-rollup`.
(EVM↔QoreChain Native only; SVM cross-calls are separate.) See [Multi-VM](guides/multi-vm.md).

---

## Everything else you'd expect

Beyond the differentiators, the RDK ships the table-stakes too: five published
language clients verified against shared golden vectors, the five preset profiles
and the full compatibility matrix, settlement-batch and lifecycle management,
native data availability, a **watchtower** auto-challenger for optimistic
rollups, and the `qorollup` operator CLI.

## Next

- [Install](install.md) — per-language install.
- [Quickstart](quickstart.md) — from zero to a live testnet rollup.
- [Quantum-safe settlement receipts](guides/settlement-receipts.md) ·
  [QCAI Copilot](guides/qcai-copilot.md) ·
  [Multi-VM](guides/multi-vm.md) — the deep dives.
