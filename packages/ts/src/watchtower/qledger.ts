/**
 * Watching qledger-v1 rollups.
 *
 * The chain decides a challenge against a qledger-v1 batch by re-executing the
 * inbox entries the batch consumed from its parent state and comparing the
 * state and withdrawals roots it published ({@link checkQledgerFraud}). A
 * qledger-v1 state root is the root of the account tree, not the canonical
 * transition root other optimistic rollups publish, so
 * {@link transitionRootValidator} reports every honest qledger-v1 batch as
 * invalid, and {@link fraudProofForBatch} builds a proof the chain dismisses.
 *
 * {@link qledgerValidator} applies the chain's own qledger-v1 rule: it rebuilds
 * the parent state by replaying the rollup's earlier batches, reads the entries
 * the batch consumed, builds the fraud proof a challenger would send, and
 * decides it with {@link checkQledgerFraud}, the same decision the chain makes.
 * A batch it rejects is one the proof from {@link qledgerFraudProofForBatch}
 * wins.
 */
import { decodeWireBytes, bytesToHex } from "../utils/bytes";
import { EMPTY_INBOX_ACC } from "../inbox";
import { executeQledger, type QledgerEntry } from "../qledger/exec";
import { buildQledgerFraudProof, checkQledgerFraud } from "../qledger/fraud";
import { fetchQledgerEntries } from "../qledger/batch";
import { QledgerLedger } from "../qledger/smt";
import type { RdkClient } from "../client/rdk-client";
import type { BatchView } from "../client/views";

/** Reads the inbox entries a batch consumed: sequences `from + 1` through `to`. */
export type QledgerEntryReader = (range: {
  from: bigint;
  to: bigint;
  /** The inbox accumulator after entry `from` (the batch's start). */
  accFrom: Uint8Array;
}) => Promise<QledgerEntry[]>;

export interface QledgerValidatorOptions {
  /**
   * Where the entries come from. Defaults to {@link fetchQledgerEntries}, which
   * reads them back from the node's transaction index and checks them against
   * the chain's inbox accumulator. Supply your own to read from an archive of
   * posts you keep, for example once the node has pruned old transactions.
   */
  readEntries?: QledgerEntryReader;
  /** How many parent states to keep in memory (default 32). Older ones are rebuilt by replay. */
  maxCachedStates?: number;
}

/** How a qledger-v1 batch fares under the chain's fraud rule. */
export interface QledgerJudgement {
  /** `true` when a challenge against the batch would be dismissed. */
  valid: boolean;
  /** The roots an honest batch over the same entries publishes. */
  honest: { stateRoot: Uint8Array; withdrawalsRoot: Uint8Array };
  /** For an invalid batch: the encoded proof that wins `challengeBatch`. */
  proof?: Uint8Array;
}

const hexOf = (wire: string): string => bytesToHex(decodeWireBytes(wire));

/**
 * Judges the batches of one qledger-v1 rollup, keeping the honest ledger after
 * each batch it accepts so the next batch is judged without a full replay.
 * Calls are serialized; use one judge per rollup.
 */
export class QledgerJudge {
  private readonly env: { chainId: string; rollupId: string };
  private readonly read: QledgerEntryReader;
  private readonly maxStates: number;
  private readonly emptyRoot: string;
  /** Honest ledgers by state root (hex), oldest first. */
  private readonly states = new Map<string, QledgerLedger>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: RdkClient,
    rollupId: string,
    opts: QledgerValidatorOptions = {},
  ) {
    this.env = { chainId: client.network.chainId, rollupId };
    this.maxStates = Math.max(2, opts.maxCachedStates ?? 32);
    this.read =
      opts.readEntries ??
      (({ from, to, accFrom }) =>
        fetchQledgerEntries(client.rest, { ...this.env, from, to, accFrom }));
    const empty = new QledgerLedger();
    this.emptyRoot = bytesToHex(empty.root());
    this.states.set(this.emptyRoot, empty);
  }

  /** Decide `batch` as the chain would decide a challenge against it. */
  judge(batch: BatchView): Promise<QledgerJudgement> {
    const run = this.queue.then(() => this.judgeNow(batch));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private remember(root: string, ledger: QledgerLedger): void {
    this.states.delete(root);
    this.states.set(root, ledger);
    while (this.states.size > this.maxStates) {
      const oldest = [...this.states.keys()].find((k) => k !== this.emptyRoot);
      if (oldest === undefined) break;
      this.states.delete(oldest);
    }
  }

  /** The inbox accumulator after entry `seq` (posted data is numbered from 1). */
  private async accAfter(seq: number): Promise<Uint8Array> {
    if (seq === 0) return EMPTY_INBOX_ACC;
    return decodeWireBytes((await this.client.rest.getPostedData(this.env.rollupId, seq)).inboxAcc);
  }

  private async judgeNow(batch: BatchView): Promise<QledgerJudgement> {
    const parent = await this.ledgerAt(hexOf(batch.prevStateRoot));
    return this.judgeOn(parent, batch);
  }

  private async judgeOn(parent: QledgerLedger, batch: BatchView): Promise<QledgerJudgement> {
    const accFrom = await this.accAfter(batch.inboxStart);
    const entries = await this.read({
      from: BigInt(batch.inboxStart),
      to: BigInt(batch.inboxEnd),
      accFrom,
    });
    const { proof, honest } = buildQledgerFraudProof(this.env, parent, accFrom, entries);
    // The chain's own decision on that proof. It throws when the entries do not
    // belong to this batch, which leaves the batch undecided rather than invalid.
    const fraud = checkQledgerFraud(
      this.env,
      {
        inboxStart: batch.inboxStart,
        inboxEnd: batch.inboxEnd,
        dataHash: decodeWireBytes(batch.dataHash),
        prevStateRoot: decodeWireBytes(batch.prevStateRoot),
        stateRoot: decodeWireBytes(batch.stateRoot),
        withdrawalsRoot: decodeWireBytes(batch.withdrawalsRoot),
      },
      proof,
    );
    if (!fraud) {
      const next = parent.clone();
      executeQledger(this.env, next, entries);
      this.remember(bytesToHex(next.root()), next);
    }
    return {
      valid: !fraud,
      honest: { stateRoot: honest.stateRoot, withdrawalsRoot: honest.withdrawalsRoot },
      ...(fraud ? { proof } : {}),
    };
  }

  /**
   * The honest ledger whose root is `root`, replaying the rollup's batches in
   * order from the empty ledger when it is not already known. Only a batch that
   * reproduces from a known state is followed, so a root that no honest replay
   * reaches is refused: the batch that introduced it is the one to challenge.
   */
  private async ledgerAt(root: string): Promise<QledgerLedger> {
    const known = this.states.get(root);
    if (known) return known;
    const batches = (await this.client.rest.listBatches(this.env.rollupId))
      .filter((b) => b.status !== "rejected")
      .sort((a, b) => a.batchIndex - b.batchIndex);
    for (const b of batches) {
      const state = hexOf(b.stateRoot);
      if (this.states.has(state)) continue;
      const parent = this.states.get(hexOf(b.prevStateRoot));
      if (!parent) continue;
      await this.judgeOn(parent, b);
      const found = this.states.get(root);
      if (found) return found;
    }
    throw new Error(
      `qledger: no honest replay of ${this.env.rollupId} reaches state root ${root}; ` +
        "a batch before this one published it, and that batch is the one a challenge wins against",
    );
  }
}

/**
 * A `validate` predicate for {@link watchBatches} on a qledger-v1 rollup:
 * `true` exactly when a challenge against the batch would be dismissed. It
 * rejects (throws) when it cannot decide, for example when the batch builds on
 * a state no honest replay reaches; `watchBatches` reports that through
 * `onError` instead of flagging the batch.
 */
export function qledgerValidator(
  client: RdkClient,
  rollupId: string,
  opts: QledgerValidatorOptions = {},
): (batch: BatchView) => Promise<boolean> {
  const judge = new QledgerJudge(client, rollupId, opts);
  return async (batch) => (await judge.judge(batch)).valid;
}

/**
 * The qledger-v1 fraud proof that wins a challenge against `batch`, or
 * `undefined` when the batch is right (a challenge would be dismissed and
 * forfeit its bond). The proof has already been decided with
 * {@link checkQledgerFraud}, the rule the chain applies.
 */
export async function qledgerFraudProofForBatch(
  client: RdkClient,
  rollupId: string,
  batch: BatchView,
  opts: QledgerValidatorOptions = {},
): Promise<Uint8Array | undefined> {
  return (await new QledgerJudge(client, rollupId, opts).judge(batch)).proof;
}
