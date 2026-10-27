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

The RDK builds these exactly as the chain does, in every language, and every
proof in its test vectors is accepted by the chain's own verifier.

:::note How the chain builds the tree
- **Leaves.** Withdrawal *i* of a batch has withdrawal index *i*, and sits at
  leaf position *i*. A leaf is SHAKE-256 (32 bytes) over the withdrawal:
  - **v1** (batches submitted before chain v3.2.5): `rollup_id || 0x00 ||
    index (8B BE) || recipient || 0x00 || denom || 0x00 || amount (8B BE)`;
  - **v2** (batches submitted from v3.2.5, `rdk-withdrawals-binding`): the same
    fields, each string length-prefixed, behind the tag
    `qorechain-rdk-withdrawal/v2` and the **chain id**, so a withdrawal committed
    for one network has no valid proof on another.
- **Nodes.** SHAKE-256(left || right); leaves are not hashed again; an odd last
  node is paired with itself.
- **Which version.** A batch is v2 exactly when it was included at or above the
  height chain v3.2.5 was applied at (`transitionRootVersionForBatch`). From
  v3.2.5 a batch's `withdrawals_root` must be empty or exactly 32 bytes.

Releases before 0.7.0 defaulted to SHA-256 and re-hashed each leaf. No chain
construction uses that, so proofs built with those defaults never verified.
:::

:::note Deposits (L1 → L2) are out of scope
This guide and the RDK cover **withdrawals only**. There is no deposit message in
the module, so L1→L2 deposits are not part of this kit's surface.
:::

## The flow

1. Commit the batch's withdrawals: build the tree with `withdrawalsTree` and put
   its `root` in the batch's `withdrawalsRoot`.
2. Once the batch is **finalized**, build your withdrawal's proof from the same
   list and submit `MsgExecuteWithdrawal` with `tx.executeWithdrawal` (or
   `qorollup withdraw`).

## Build the tree and a proof

```ts
import { transitionRootVersionForBatch, withdrawalsTree } from "@qorechain/rdk";

// The batch's withdrawals, in index order.
const withdrawals = [
  { recipient: "qor1…", denom: "uqor", amount: "1500000" },
  { recipient: "qor1…", denom: "uqor", amount: "2000000" },
];

// The binding the chain judges this batch by.
const batch = await rdk.rest.getBatch("my-roll", 7);
const version = await transitionRootVersionForBatch(rdk.rest, batch); // "v1" | "v2"

const tree = withdrawalsTree(withdrawals, {
  rollupId: "my-roll",
  version,
  chainId: rdk.network.chainId, // needed for v2
});
tree.root;            // the batch's withdrawals_root (32 bytes)
const proof = tree.proof(1); // { proof: sibling hashes, withdrawalsRoot, withdrawalIndex: 1 }
```

When you build a batch, compute the version with `transitionRootVersionFor`
(the binding a batch submitted now gets) instead, right before submitting.

The single leaves are `withdrawalLeafV1(input)` and `withdrawalLeafV2(chainId,
input)`; `assembleWithdrawalProof(leaves, index)` builds a proof from leaves you
already hold, with the chain's tree by default. The generic `binaryMerkleRoot` /
`binaryMerkleProof` helpers also default to SHAKE-256, but hash each input leaf,
which the withdrawals tree does not.

## Submit `MsgExecuteWithdrawal`

`buildExecuteWithdrawalInput` combines the recipient/amount details with the
assembled proof, then `tx.executeWithdrawal` broadcasts it. The signer's address
is the submitter. The batch must be **finalized**: past its challenge window for
optimistic settlement, and from chain v3.2.5 also after every earlier batch is
final (see [Watchtower](watchtower.md)). ZK settlement cannot be used yet (see
[Settlement paradigms](../concepts/settlement-paradigms.md)).

```ts
import { buildExecuteWithdrawalInput } from "@qorechain/rdk";

const tx = await rdk.connectTx(signer, { gasPrice: "0.15uqor" });

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

`qorollup withdraw` reads a JSON spec, builds the proof with the batch's own
binding, checks the result against the batch's on-chain `withdrawals_root`, and
submits it. A root that does not match is refused **before** any fee is paid.
Use `--dry-run` to build the proof without broadcasting.

```bash
qorollup withdraw --file withdrawal.json --dry-run
qorollup withdraw --file withdrawal.json
```

`withdrawal.json` lists the batch's withdrawals in index order and the one to
execute:

```json
{
  "rollupId": "my-roll",
  "batchIndex": 7,
  "index": 1,
  "withdrawals": [
    { "recipient": "qor1…", "denom": "uqor", "amount": "1500000" },
    { "recipient": "qor1…", "denom": "uqor", "amount": "2000000" }
  ]
}
```

A spec with `leaves` (hex leaf hashes in the chain's encoding) plus `recipient`,
`denom` and `amount` is still accepted.

## Next

- [Monitoring](monitoring.md) — confirm a batch finalized before withdrawing.
- [Settlement paradigms](../concepts/settlement-paradigms.md) — when a batch is final.
- [qorollup reference](../reference/cli-qorollup.md) — the `withdraw` command.
