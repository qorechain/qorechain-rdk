/**
 * Building qledger-v1 batches by the chain's admission rules (chain v3.2.8).
 *
 * A qledger-v1 batch with `inbox_end = end` is admitted when:
 *
 * 1. the submitter holds at least `min_submitter_bond` on the rollup and has
 *    fewer than 1,024 of its batches waiting for finality;
 * 2. `consumed < end <= head` (at least one entry);
 * 3. `end - consumed <= 64`;
 * 4. `end` is the head, or the commitment of post `end` is retained;
 * 5. a batch of fewer than 64 entries that stops before the head stops just
 *    before a post made in the last 20 blocks, or at a checkpoint (`end` a
 *    multiple of 64) whose next post is no longer retained;
 * 6. `data_hash` is the inbox range commitment from `consumed` to `end`, the
 *    first batch starts from the empty ledger root, and `state_root` is 32
 *    bytes.
 */
import { bytesToHex, hexToBytes } from "../utils/bytes";
import { inboxAccumulate, inboxRangeHash, postedDataHash } from "../inbox";
import { isRestNotFound, type RestClient } from "../client/rest";
import type { RawRecord } from "../client/views";
import { executeQledger, type QledgerEntry, type QledgerResult } from "./exec";
import { QLEDGER_MAX_BATCH_ENTRIES } from "./fraud";
import { qledgerEmptyRoot, type QledgerLedger } from "./smt";
import { QLEDGER_DEPOSIT_POSTER_PREFIX, encodeQledgerDeposit } from "./tx";

/** A post younger than this many blocks may be left for the next batch. */
export const QLEDGER_FRESH_POST_BLOCKS = 20;
/** Most batches one submitter may have waiting for finality on a rollup. */
export const QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER = 1024;
/** Every post whose sequence is a multiple of this keeps its commitment until a finalized batch covers it. */
export const QLEDGER_CHECKPOINT_INTERVAL = 64;
/** Share of a slashed submitter bond that is burned (the challenger receives the rest). */
export const QLEDGER_SLASH_BURN_PERCENT = 50;

/** Whether `sequence` is a qledger-v1 checkpoint (a non-zero multiple of 64). */
export function isQledgerCheckpoint(sequence: bigint | number): boolean {
  const s = BigInt(sequence);
  return s !== 0n && s % BigInt(QLEDGER_CHECKPOINT_INTERVAL) === 0n;
}

/** What the admission rules need to know about the inbox and the submitter. */
export interface QledgerBatchFacts {
  consumed: bigint | number;
  head: bigint | number;
  end: bigint | number;
  bond: bigint | number | string;
  minBond: bigint | number | string;
  pending: bigint | number;
  /** Whether the commitment of post `end` is retained (ignored when `end` is the head). */
  endRetained: boolean;
  /** Whether the commitment of post `end + 1` is retained (needed when `end` is before the head). */
  nextRetained?: boolean;
  /** Height of post `end + 1`, when retained. */
  nextHeight?: bigint | number;
  /**
   * The height the batch is expected to be included at. The chain judges the
   * 20-block rule at inclusion, so pass the current height plus a margin for
   * the time the transaction takes to land.
   */
  inclusionHeight?: bigint | number;
}

/** Every rule the batch range would break; empty when the chain admits it. */
export function qledgerBatchErrors(f: QledgerBatchFacts): string[] {
  const errors: string[] = [];
  const consumed = BigInt(f.consumed);
  const head = BigInt(f.head);
  const end = BigInt(f.end);
  if (BigInt(f.bond) < BigInt(f.minBond)) {
    errors.push(`the submitter holds ${f.bond} uqor of bond, at least ${f.minBond} is needed`);
  }
  if (BigInt(f.pending) >= BigInt(QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER)) {
    errors.push(`the submitter already has ${f.pending} batches waiting for finality, at most ${QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER}`);
  }
  if (end <= consumed) {
    errors.push(`a batch consumes at least one inbox entry (consumed ${consumed}, inbox_end ${end})`);
    return errors;
  }
  if (end > head) errors.push(`inbox_end ${end} is past the head ${head}`);
  const n = end - consumed;
  if (n > BigInt(QLEDGER_MAX_BATCH_ENTRIES)) {
    errors.push(`a batch consumes at most ${QLEDGER_MAX_BATCH_ENTRIES} inbox entries, this one ${n}`);
  }
  if (end < head && !f.endRetained) {
    errors.push(`the commitment of post ${end} is no longer retained: end the batch at the head or at a retained post`);
  }
  if (n < BigInt(QLEDGER_MAX_BATCH_ENTRIES) && end < head) {
    const checkpointStop = isQledgerCheckpoint(end) && f.nextRetained === false;
    const freshStop =
      f.nextRetained !== false &&
      f.nextHeight !== undefined &&
      f.inclusionHeight !== undefined &&
      BigInt(f.nextHeight) + BigInt(QLEDGER_FRESH_POST_BLOCKS) > BigInt(f.inclusionHeight);
    if (!checkpointStop && !freshStop) {
      errors.push(
        `a batch of fewer than ${QLEDGER_MAX_BATCH_ENTRIES} entries consumes every post older than ` +
          `${QLEDGER_FRESH_POST_BLOCKS} blocks: post ${end + 1n} must be in it`,
      );
    }
  }
  return errors;
}

/**
 * The `end` a submitter should choose (the chain's recommended logic): a full
 * batch of 64 or the head when that position is retained, otherwise the next
 * checkpoint (after a long idle period, when only checkpoints kept their
 * commitments). `undefined` when nothing is waiting.
 */
export async function chooseQledgerBatchEnd(input: {
  consumed: bigint | number;
  head: bigint | number;
  /** Whether the commitment of post `x` is retained (`RestClient.getInbox(rollup, x).rangeDataHash !== ""`). */
  retained: (x: bigint) => boolean | Promise<boolean>;
}): Promise<bigint | undefined> {
  const consumed = BigInt(input.consumed);
  const head = BigInt(input.head);
  if (head <= consumed) return undefined;
  const max = BigInt(QLEDGER_MAX_BATCH_ENTRIES);
  const want = head < consumed + max ? head : consumed + max;
  if (want === head || (await input.retained(want))) return want;
  const interval = BigInt(QLEDGER_CHECKPOINT_INTERVAL);
  return (consumed / interval + 1n) * interval;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function attrs(ev: RawRecord): Record<string, string> {
  const out: Record<string, string> = {};
  const list = Array.isArray(ev.attributes) ? (ev.attributes as RawRecord[]) : [];
  for (const a of list) out[String(a.key)] = String(a.value ?? "");
  return out;
}

/**
 * The inbox entries `from + 1 .. to` of a qledger-v1 rollup, read back from
 * the transactions that posted them (the chain keeps only commitments; the
 * bytes stay in block history). Posts come from `MsgPostRollupData`, deposits
 * from the `rdk_rollup_deposit` event. Every entry is checked against the
 * chain's inbox accumulator before it is returned. Needs a node with
 * transaction indexing on.
 */
export async function fetchQledgerEntries(
  rest: RestClient,
  input: { chainId: string; rollupId: string; from: bigint | number; to: bigint | number; accFrom: Uint8Array | string },
): Promise<QledgerEntry[]> {
  const from = BigInt(input.from);
  const to = BigInt(input.to);
  const bySeq = new Map<bigint, QledgerEntry>();
  const q = (t: string) => `${t}.rollup_id='${input.rollupId}'`;
  for (const tx of await rest.searchTxs(q("rdk_data_posted"))) {
    const height = BigInt(String(tx.height ?? "0"));
    const msgs = ((((tx.tx as RawRecord)?.body as RawRecord)?.messages as RawRecord[]) ?? []).filter(
      (m) => m["@type"] === "/qorechain.rdk.v1.MsgPostRollupData",
    );
    for (const ev of (tx.events as RawRecord[]) ?? []) {
      if (ev.type !== "rdk_data_posted") continue;
      const a = attrs(ev);
      if (a.rollup_id !== input.rollupId) continue;
      const seq = BigInt(a.sequence ?? "0");
      if (seq <= from || seq > to) continue;
      const m = msgs.find((x) => {
        const d = b64(String(x.data ?? ""));
        return bytesToHex(postedDataHash(d)) === a.data_hash && String(x.poster) === a.poster;
      });
      if (!m) throw new Error(`qledger: post ${seq} is in transaction ${tx.txhash} but its payload could not be matched`);
      bySeq.set(seq, { height, poster: a.poster!, payload: b64(String(m.data)) });
    }
  }
  for (const tx of await rest.searchTxs(q("rdk_rollup_deposit"))) {
    const height = BigInt(String(tx.height ?? "0"));
    for (const ev of (tx.events as RawRecord[]) ?? []) {
      if (ev.type !== "rdk_rollup_deposit") continue;
      const a = attrs(ev);
      if (a.rollup_id !== input.rollupId) continue;
      const seq = BigInt(a.sequence ?? "0");
      if (seq <= from || seq > to) continue;
      const amount = BigInt((a.amount ?? "0").replace(/uqor$/, ""));
      bySeq.set(seq, {
        height,
        poster: QLEDGER_DEPOSIT_POSTER_PREFIX + a.depositor,
        payload: encodeQledgerDeposit(hexToBytes(a.account!), amount),
      });
    }
  }
  const entries: QledgerEntry[] = [];
  for (let s = from + 1n; s <= to; s++) {
    const e = bySeq.get(s);
    if (!e) throw new Error(`qledger: inbox entry ${s} of rollup ${input.rollupId} was not found in the node's transaction index`);
    entries.push(e);
  }
  // Check the entries against the chain's own accumulator at `to`: the
  // commitment of post `to` when retained, else the head when `to` is it.
  const accTo = bytesToHex(qledgerAccumulate({ ...input, entries }));
  let want: string | undefined;
  try {
    want = (await rest.getPostedData(input.rollupId, to)).inboxAcc;
  } catch (err) {
    if (!isRestNotFound(err)) throw err;
    const inbox = await rest.getInbox(input.rollupId);
    if (BigInt(inbox.headSequence) === to) want = inbox.headAcc;
  }
  if (!want) throw new Error(`qledger: the chain no longer holds the accumulator at ${to}, so the entries cannot be checked`);
  if (want.replace(/^0x/, "").toLowerCase() !== accTo) {
    throw new Error(`qledger: the entries read back for ${input.rollupId} do not match the chain's inbox accumulator at ${to}`);
  }
  return entries;
}

/** The inbox accumulator after `entries`, starting from `accFrom` at sequence `from`. */
export function qledgerAccumulate(input: {
  chainId: string;
  rollupId: string;
  from: bigint | number;
  accFrom: Uint8Array | string;
  entries: QledgerEntry[];
}): Uint8Array {
  let acc: Uint8Array | string = input.accFrom;
  input.entries.forEach((e, i) => {
    acc = inboxAccumulate({
      chainId: input.chainId,
      rollupId: input.rollupId,
      prevAcc: acc,
      sequence: BigInt(input.from) + BigInt(i) + 1n,
      height: e.height,
      poster: e.poster,
      dataHash: postedDataHash(e.payload),
    });
  });
  return typeof acc === "string" ? hexToBytes(acc) : acc;
}

/** A qledger-v1 batch ready for `RdkTxClient.submitBatch`, with what it settles. */
export interface QledgerBatchPlan {
  /** Pass to `submitBatch` (the client fills in the sequencer). */
  input: {
    rollupId: string;
    batchIndex: bigint;
    prevStateRoot: Uint8Array;
    stateRoot: Uint8Array;
    txCount: bigint;
    dataHash: Uint8Array;
    withdrawalsRoot: Uint8Array;
    inboxEnd: bigint;
  };
  /** The entries consumed and the execution result (withdrawals to pay later). */
  entries: QledgerEntry[];
  result: QledgerResult;
  /** The ledger after the batch: the parent state of the next one. */
  ledger: QledgerLedger;
}

/**
 * Plan the next qledger-v1 batch of a rollup from the chain: choose `end` by
 * the admission rules, fetch and verify the entries, execute them on `ledger`
 * (the state after the rollup's latest batch, or an empty ledger before the
 * first), and return the batch. Throws with the chain's reason when no batch
 * can be admitted now (no bond, too many pending, nothing to consume).
 *
 * The submitter keeps `plan.ledger` as the parent state of its next batch once
 * this one settles.
 */
export async function planQledgerBatch(
  rest: RestClient,
  input: {
    chainId: string;
    rollupId: string;
    submitter: string;
    ledger: QledgerLedger;
    /** Blocks added to the current height for the 20-block rule (default 5). */
    inclusionMargin?: number;
  },
): Promise<QledgerBatchPlan> {
  const { chainId, rollupId } = input;
  const [rollup, params, bond, inbox] = await Promise.all([
    rest.getRollup(rollupId),
    rest.getParams(),
    rest.getSubmitterBond(rollupId, input.submitter),
    rest.getInbox(rollupId),
  ]);
  if (rollup.executionVm !== "qledger-v1") throw new Error(`rollup ${rollupId} is not a qledger-v1 rollup`);
  const consumed = BigInt(inbox.consumedSequence);
  const head = BigInt(inbox.headSequence);
  const retained = async (x: bigint) => x === head || (await rest.getInbox(rollupId, x)).rangeDataHash !== "";
  const end = await chooseQledgerBatchEnd({ consumed, head, retained });
  if (end === undefined) throw new Error(`rollup ${rollupId} has nothing to settle: its inbox is fully consumed`);

  let nextRetained: boolean | undefined;
  let nextHeight: number | undefined;
  if (end < head) {
    try {
      nextHeight = (await rest.getPostedData(rollupId, end + 1n)).height;
      nextRetained = true;
    } catch (err) {
      if (!isRestNotFound(err)) throw err;
      nextRetained = false;
    }
  }
  const inclusionHeight = (await rest.getLatestHeight()) + (input.inclusionMargin ?? 5);
  const errors = qledgerBatchErrors({
    consumed,
    head,
    end,
    bond: bond.amount,
    minBond: params.minSubmitterBond ?? "1000000000",
    pending: bond.pending,
    endRetained: await retained(end),
    nextRetained,
    nextHeight,
    inclusionHeight,
  });
  if (errors.length > 0) throw new Error(`no qledger-v1 batch can be admitted now: ${errors.join("; ")}`);

  const range = await rest.getInbox(rollupId, end);
  const entries = await fetchQledgerEntries(rest, { chainId, rollupId, from: consumed, to: end, accFrom: inbox.consumedAcc });
  const accTo = qledgerAccumulate({ chainId, rollupId, from: consumed, accFrom: inbox.consumedAcc, entries });
  const dataHash = inboxRangeHash({ chainId, rollupId, from: consumed, to: end, accFrom: inbox.consumedAcc, accTo });
  if (range.rangeDataHash && bytesToHex(dataHash) !== range.rangeDataHash.replace(/^0x/, "").toLowerCase()) {
    throw new Error("qledger: the fetched entries do not hash to the chain's inbox range commitment");
  }

  let latest: { batchIndex: number; stateRoot: string } | undefined;
  try {
    latest = await rest.getLatestBatch(rollupId);
  } catch (err) {
    if (!isRestNotFound(err)) throw err;
    latest = undefined;
  }
  const prevStateRoot = latest ? hexToBytes(latest.stateRoot) : qledgerEmptyRoot();
  if (bytesToHex(input.ledger.root()) !== bytesToHex(prevStateRoot)) {
    throw new Error(
      `qledger: the ledger you passed has root ${bytesToHex(input.ledger.root())}, ` +
        `but the rollup's latest state root is ${bytesToHex(prevStateRoot)}`,
    );
  }
  const ledger = input.ledger.clone();
  const result = executeQledger({ chainId, rollupId }, ledger, entries);
  return {
    input: {
      rollupId,
      batchIndex: latest ? BigInt(latest.batchIndex) + 1n : 0n,
      prevStateRoot,
      stateRoot: result.stateRoot,
      txCount: BigInt(entries.length),
      dataHash,
      withdrawalsRoot: result.withdrawalsRoot,
      inboxEnd: end,
    },
    entries,
    result,
    ledger,
  };
}
