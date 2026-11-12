---
id: rollup-data
title: Rollup data, based sequencing and private rollups
sidebar_position: 16
---

# Rollup data, based sequencing and private rollups

From chain v3.2.8 a rollup can put its data on QoreChain, let the chain order
its transactions, and keep its data private to a set of members. This page
covers the three features and the RDK helpers for each.

## Posting rollup data

`postRollupData` sends `MsgPostRollupData`. The payload stays in the
transaction, so it is in the block; the chain keeps a commitment (SHA-256 of the
data, its size, the poster and the height) under the rollup's next inbox
sequence, starting at 1.

```ts
const res = await tx.postRollupData({ rollupId: "my-rollup", data: payload });
```

- **Who may post:** the rollup's sequencer (its creator when none is set), or
  anyone on a based rollup.
- **Limits:** `max_posted_data_bytes` per post (default 128 KiB) and
  `max_posted_data_bytes_per_block` across all rollups (default 512 KiB).
- **Fee:** `posted_data_fee_per_byte` uqor per billable byte (default 10), with
  at least 1 KiB billed per post, on top of gas.
- **Retention:** the commitment is pruned after `posted_data_retention_blocks`
  (default 648,000; at most 25,920,000, and never shorter than the longest
  challenge window in force, counted as one block per second); the bytes stay
  in block history.

Read the live values with `rdk.params()`, and a post's commitment with
`RestClient.getPostedData(rollupId, sequence)`.

A batch of a native-DA rollup that is not based may carry
`postedDataHash(data)` (SHA-256) of a retained post as its `dataHash`.

## Based sequencing

A rollup created with `sequencing: "based"` (or moved there by governance) is
ordered by inclusion on QoreChain. Anyone posts; each post gets the next inbox
sequence; every batch consumes the inbox in order.

Each batch of a based rollup sets `inboxEnd` (the sequence of the last post it
consumes) and carries the inbox range commitment as `dataHash`. Ask the chain
for it, or compute it from the accumulators:

```ts
const inbox = await rest.getInbox("my-rollup", inboxEnd);
await tx.submitBatch({
  rollupId: "my-rollup",
  batchIndex,
  stateRoot,
  prevStateRoot,
  txCount,
  inboxEnd,
  dataHash: inbox.rangeDataHash,
  proof,
});
```

`inboxAccumulate` and `inboxRangeHash` reproduce the chain's commitments, so a
prover can bind the same range without trusting a node:

```
acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp(chain_id) | lp(rollup_id) | acc_{n-1}
                | be64(n) | be64(height) | lp(poster) | SHA-256(data))
range = SHA-256("qorechain/rdk/inbox-range/v1" | lp(chain_id) | lp(rollup_id)
                | be64(from) | be64(to) | acc_from | acc_to)
```

`acc_0` is 32 zero bytes and `lp` is a 4-byte big-endian length prefix.

Which rollups can be based:

| Rollup | Who submits batches |
| --- | --- |
| zk with a Groth16 key (`defi`) | Any account: the proof binds the roots, the inbox range and the withdrawals root |
| based settlement (`gaming`, `enterprise`) | The rollup's sequencer only |
| optimistic with `executionVm: "qledger-v1"` (`nft`, `custom`) | Any account holding a submitter bond |

A based rollup is paused, resumed and stopped by governance only.

## qledger-v1 rollups

From chain v3.2.8 a new optimistic rollup must use the qledger-v1 execution
model and be based. Users credit it with `depositToRollup` (at least 1 QOR, to a
32-byte qledger-v1 account id) and post signed transfers and withdrawals. A
submitter bonds with `bondRollupSubmitter` (at least `min_submitter_bond`,
default 1,000 QOR; see `RestClient.getSubmitterBond`) and can unbond with
`unbondRollupSubmitter` a full challenge window after its last batch. A fraud
proof makes the chain re-execute the batch, and an upheld one pays the
submitter's whole bond to the challenger. Withdrawals are paid from the
rollup's deposit pool, and the rollup cannot be stopped while the pool holds
deposits.

### Building qledger-v1 batches

A qledger-v1 batch with `inboxEnd = end` is admitted when:

1. the submitter holds at least `min_submitter_bond` and has fewer than 1,024
   of its batches waiting for finality (`RestClient.getSubmitterBond` returns
   `pending`);
2. it consumes between 1 and 64 inbox entries after the consumed position;
3. `end` is the head, or the commitment of post `end` is still retained;
4. a batch of fewer than 64 entries that stops before the head stops just
   before a post made in the last 20 blocks, or at a checkpoint (a multiple of
   64) whose next post is no longer retained;
5. `dataHash` is the inbox range commitment, the first batch starts from the
   empty ledger root, and every batch starts from the latest state root.

`planQledgerBatch` does all of it: it chooses `end`, reads the entries back
from the transactions that posted them (the chain keeps only commitments, so
the node must index transactions), checks them against the chain's inbox
accumulator, executes them on your ledger and returns the batch:

```ts
const plan = await planQledgerBatch(rest, { chainId, rollupId, submitter: tx.address, ledger });
await tx.submitBatch(plan.input);
ledger = plan.ledger; // the parent state of the next batch, once this one settles
```

`qledgerBatchErrors` and `chooseQledgerBatchEnd` expose the rules on their
own; `submitBatch` runs the same checks before the fee.

**After a long idle period.** Commitments are kept for the retention period and
up to four more while no finalized batch covers them; after that only the
checkpoints (every 64th post) stay. A submitter then catches up checkpoint by
checkpoint: one batch to the next multiple of 64, full batches of 64 between
checkpoints, then a last batch to the head. `chooseQledgerBatchEnd` follows
this order.

**Fraud proofs.** `buildQledgerFraudProof` builds the proof a challenger sends,
and `checkQledgerFraud` decides it exactly as the chain does. An upheld proof
rejects the batch and every batch built on it; half of the slashed bond is
burned and the challenger receives the rest.

## Private rollups

A zk rollup with a Groth16 key created with `privacy: "encapsulated"` takes only
posts that are envelopes to its members. The creator sets the members with
`setRollupMembers` (at most 32, each with a registered ML-KEM-1024 key); each
change starts a new membership epoch.

An envelope encrypts the data once with AES-256-GCM under a fresh key, and
encapsulates that key with ML-KEM-1024 to every member's key, with a key
commitment so all members open the same content. The chain checks the
structure, the epoch, the member order and each member's key fingerprint; it
never decrypts.

Each member first publishes an ML-KEM-1024 key in the chain's KEM registry
(chain v3.2.5+). Keep the 64-byte seed secret; it opens envelopes.

```ts
const { publicKey } = kemKeypairFromSeed(seed);
await memberTx.registerKemKey({ publicKey });
```

To post, seal to the members' registered keys at the current epoch:

```ts
const { epoch, recipients } = await rest.getPrivateRollupRecipients("my-private-rollup");
const envelope = sealEnvelope({ chainId, rollupId: "my-private-rollup", epoch, recipients, plaintext });
await tx.postRollupData({ rollupId: "my-private-rollup", data: envelope });

// A member, offline:
const data = openEnvelope({ envelope, chainId, rollupId: "my-private-rollup", member, decapsulationKey: seed });
```

`envelopeMembershipError` runs the chain's structural check before you pay the
fee. Posts, the poster, timing, sizes, members, roots and withdrawals
(recipient and amount) stay public; only the post contents are private.
