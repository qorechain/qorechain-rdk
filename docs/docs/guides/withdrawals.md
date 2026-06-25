---
id: withdrawals
title: Withdrawals
sidebar_position: 9
---

# Withdrawals (L2 → L1)

A rollup executes transactions off the Main Chain, but value that should return
to L1 must be **proven** there. Each settlement batch commits its L2→L1 messages
(withdrawals) as a binary Merkle root, `withdrawals_root`. To withdraw, you prove
that your withdrawal's leaf is committed in a finalized batch's root by carrying
the sibling-hash path to that root in `MsgExecuteWithdrawal`.

The RDK ships the building blocks: binary-Merkle utilities, a proof assembler,
and the `executeWithdrawal` transaction.

:::caution Leaf encoding must match the network
The leaf encoding, the hash function, and odd-node handling **must match the
network's `withdrawals_root` construction** for the proof to verify on-chain. The
helpers default to a common convention (SHA-256, hash each leaf, duplicate the
last node on odd levels, no domain separation) but are fully configurable —
override `MerkleOptions` to match the chain exactly. A proof built with the wrong
convention will be rejected.
:::

:::note Deposits (L1 → L2) are out of scope
This guide and the RDK cover **withdrawals only**. There is no deposit message in
the module, so L1→L2 deposits are not part of this kit's surface.
:::

## The flow

1. Collect the batch's withdrawal leaves and find your withdrawal's index.
2. Assemble the Merkle proof with `assembleWithdrawalProof`.
3. Verify the assembled root matches the batch's `withdrawals_root`.
4. Submit `MsgExecuteWithdrawal` with `tx.executeWithdrawal` (or `qorollup
   withdraw`), once the batch is finalized.

## Assemble the proof

`assembleWithdrawalProof` turns the full list of a batch's withdrawal leaves and
your leaf's index into the sibling-hash proof the message carries, plus the
computed root.

```ts
import { assembleWithdrawalProof, hexToBytes } from "@qorechain/rdk";

// The batch's withdrawal leaves, in order, and your withdrawal's index.
const leaves = batchLeavesHex.map((h) => hexToBytes(h));
const withdrawalIndex = 3;

const proof = assembleWithdrawalProof(leaves, withdrawalIndex);
console.log(proof.proof);            // Uint8Array[] — sibling hashes, leaf level first
console.log(proof.withdrawalsRoot);  // Uint8Array — compare against the batch's
console.log(proof.withdrawalIndex);  // 3
```

If your network uses a different leaf hash or odd-node rule, pass `MerkleOptions`
to **every** helper so the construction stays consistent:

```ts
import { assembleWithdrawalProof } from "@qorechain/rdk";

const options = {
  hash: myHashFn,        // default: SHA-256
  hashLeaves: true,      // hash each input leaf before building the tree
  duplicateOdd: true,    // on an odd level, duplicate the last node
};
const proof = assembleWithdrawalProof(leaves, withdrawalIndex, options);
```

## Verify before you submit

Confirm the assembled root matches the batch's committed `withdrawals_root`, and
sanity-check the proof locally with `verifyBinaryMerkleProof`:

```ts
import { verifyBinaryMerkleProof } from "@qorechain/rdk";

const ok = verifyBinaryMerkleProof(
  leaves[withdrawalIndex],   // the leaf
  withdrawalIndex,
  proof.proof,               // sibling hashes
  proof.withdrawalsRoot,     // the root the proof builds to
);
console.log(ok); // true if the leaf is committed under that root
```

You can also compute a root directly with `binaryMerkleRoot(leaves, options)` or
build a raw proof with `binaryMerkleProof(leaves, index, options)`.

## Submit `MsgExecuteWithdrawal`

`buildExecuteWithdrawalInput` combines the recipient/amount details with the
assembled proof, then `tx.executeWithdrawal` broadcasts it. The signer's address
is the submitter. The batch must be **finalized** (past its challenge window for
optimistic settlement, or proof-verified for ZK).

```ts
import { buildExecuteWithdrawalInput } from "@qorechain/rdk";

const tx = await rdk.connectTx(signer, { gasPrice: "0.025uqor" });

const input = buildExecuteWithdrawalInput({
  submitter: tx.address,
  rollupId: "my-roll",
  batchIndex: 7,
  recipient: "qor1recipient...",
  denom: "uqor",
  amount: "1000000",
  withdrawal: proof,
});

const res = await tx.executeWithdrawal({
  rollupId: input.rollupId,
  batchIndex: input.batchIndex,
  withdrawalIndex: input.withdrawalIndex,
  recipient: input.recipient,
  denom: input.denom,
  amount: input.amount,
  proof: input.proof,
});
console.log(res.transactionHash);
```

## The CLI equivalent

`qorollup withdraw` reads a JSON spec, assembles the proof, and submits it. Use
`--dry-run` to assemble and report the proof without broadcasting.

```bash
qorollup withdraw --file withdrawal.json --dry-run
qorollup withdraw --file withdrawal.json
```

`withdrawal.json`:

```json
{
  "rollupId": "my-roll",
  "batchIndex": 7,
  "recipient": "qor1recipient...",
  "denom": "uqor",
  "amount": "1000000",
  "leaves": ["<hex leaf 0>", "<hex leaf 1>", "..."],
  "index": 3
}
```

The CLI uses the default Merkle convention. If your network differs, assemble the
proof in code with the matching `MerkleOptions` instead.

## Next

- [Monitoring](monitoring.md) — confirm a batch finalized before withdrawing.
- [Settlement paradigms](../concepts/settlement-paradigms.md) — when a batch is final.
- [qorollup reference](../reference/cli-qorollup.md) — the `withdraw` command.
