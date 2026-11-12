/**
 * qledger-v1 fraud proofs: the challenger's side (build) and the chain's
 * decision (check), so a watcher can decide a batch locally before paying.
 *
 * ```
 * "QLFP" | 0x01 | acc_from[32] | be16(n) | n × (be64(height) | be16(len) poster | be32(len) payload)
 * | be16(m) | m × (id[32] | be64(balance) | be64(nonce) | bitmap[32] | popcount(bitmap) × sibling[32])
 * ```
 */
import { bytesToHex, toBytes } from "../utils/bytes";
import { EMPTY_INBOX_ACC, inboxAccumulate, inboxRangeHash, postedDataHash } from "../inbox";
import { executeQledger, type QledgerEntry, type QledgerResult } from "./exec";
import { QledgerLedger, QledgerPartialTree, type QledgerState, type QledgerWitness } from "./smt";
import { be64 } from "./tx";

/** Most inbox entries one qledger-v1 batch may consume. */
export const QLEDGER_MAX_BATCH_ENTRIES = 64;
/** Largest post a qledger-v1 rollup accepts. */
export const QLEDGER_MAX_POST_BYTES = 6 * 1024;
const MAX_WITNESSES = 2 * QLEDGER_MAX_BATCH_ENTRIES;
const MAX_POSTER_LEN = 256;
const MAGIC = new TextEncoder().encode("QLFP");

export interface QledgerFraudProof {
  accFrom: Uint8Array;
  entries: QledgerEntry[];
  witnesses: QledgerWitness[];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const u16 = (v: number) => new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, false);
  return b;
}

export function encodeQledgerFraudProof(p: QledgerFraudProof): Uint8Array {
  const parts: Uint8Array[] = [MAGIC, new Uint8Array([1]), p.accFrom, u16(p.entries.length)];
  for (const e of p.entries) {
    const poster = new TextEncoder().encode(e.poster);
    parts.push(be64(BigInt(e.height)), u16(poster.length), poster, u32(e.payload.length), e.payload);
  }
  parts.push(u16(p.witnesses.length));
  for (const w of p.witnesses) parts.push(w.id, be64(w.balance), be64(w.nonce), w.bitmap, ...w.siblings);
  return concat(parts);
}

export function decodeQledgerFraudProof(input: Uint8Array | string): QledgerFraudProof {
  const b = toBytes(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const bad = () => new Error("qledger: malformed fraud proof");
  const take = (n: number) => {
    if (n < 0 || b.length - p < n) throw bad();
    const out = b.slice(p, p + n);
    p += n;
    return out;
  };
  const head = take(5);
  if (!MAGIC.every((x, i) => head[i] === x) || head[4] !== 1) throw bad();
  const accFrom = take(32);
  take(2);
  const n = dv.getUint16(p - 2, false);
  if (n > QLEDGER_MAX_BATCH_ENTRIES) throw bad();
  const entries: QledgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    take(8);
    const height = dv.getBigUint64(p - 8, false);
    take(2);
    const pl = dv.getUint16(p - 2, false);
    if (pl > MAX_POSTER_LEN) throw bad();
    const poster = new TextDecoder().decode(take(pl));
    take(4);
    const ln = dv.getUint32(p - 4, false);
    if (ln > QLEDGER_MAX_POST_BYTES) throw bad();
    entries.push({ height, poster, payload: take(ln) });
  }
  take(2);
  const m = dv.getUint16(p - 2, false);
  if (m > MAX_WITNESSES) throw bad();
  const witnesses: QledgerWitness[] = [];
  for (let i = 0; i < m; i++) {
    const id = take(32);
    take(16);
    const balance = dv.getBigUint64(p - 16, false);
    const nonce = dv.getBigUint64(p - 8, false);
    const bitmap = take(32);
    let cnt = 0;
    for (const x of bitmap) for (let k = 0; k < 8; k++) cnt += (x >> k) & 1;
    const siblings: Uint8Array[] = [];
    for (let j = 0; j < cnt; j++) siblings.push(take(32));
    witnesses.push({ id, balance, nonce, bitmap, siblings });
  }
  if (p !== b.length) throw bad();
  return { accFrom, entries, witnesses };
}

/** Records every account an execution touches, in first-touch order. */
class Recorder implements QledgerState {
  readonly order: Uint8Array[] = [];
  private readonly seen = new Set<string>();
  constructor(private readonly inner: QledgerState) {}
  private note(id: Uint8Array) {
    const k = bytesToHex(id);
    if (!this.seen.has(k)) {
      this.seen.add(k);
      this.order.push(id.slice());
    }
  }
  get(id: Uint8Array) {
    this.note(id);
    return this.inner.get(id);
  }
  set(id: Uint8Array, balance: bigint, nonce: bigint) {
    this.note(id);
    this.inner.set(id, balance, nonce);
  }
  root() {
    return this.inner.root();
  }
}

/**
 * The challenger's side: from the batch's parent state, the inbox accumulator
 * at the batch's start and the entries it consumed, the encoded proof to send
 * with `challengeBatch`, and the result an honest batch would have published.
 */
export function buildQledgerFraudProof(
  env: { chainId: string; rollupId: string },
  parent: QledgerLedger,
  accFrom: Uint8Array | string,
  entries: QledgerEntry[],
): { proof: Uint8Array; honest: QledgerResult } {
  const rec = new Recorder(parent.clone());
  const honest = executeQledger(env, rec, entries);
  const acc = toBytes(accFrom);
  const proof = encodeQledgerFraudProof({
    accFrom: acc.length === 0 ? EMPTY_INBOX_ACC : acc,
    entries,
    witnesses: rec.order.map((id) => parent.witness(id)),
  });
  return { proof, honest };
}

/** What a qledger-v1 batch published. */
export interface QledgerClaim {
  inboxStart: bigint | number;
  inboxEnd: bigint | number;
  dataHash: Uint8Array | string;
  prevStateRoot: Uint8Array | string;
  stateRoot: Uint8Array | string;
  withdrawalsRoot: Uint8Array | string;
}

/**
 * Decide a fraud proof as the chain does: `true` when re-executing the batch's
 * inputs from its parent state gives a different state or withdrawals root
 * than it published, `false` when the batch is right. Throws when the proof
 * cannot decide (malformed, not about this batch, incomplete witness): the
 * chain refuses such a challenge.
 */
export function checkQledgerFraud(
  env: { chainId: string; rollupId: string },
  claim: QledgerClaim,
  proof: Uint8Array | string,
): boolean {
  const p = decodeQledgerFraudProof(proof);
  const start = BigInt(claim.inboxStart);
  const end = BigInt(claim.inboxEnd);
  if (end < start || BigInt(p.entries.length) !== end - start) {
    throw new Error(`qledger: the fraud proof does not apply: ${p.entries.length} entries for inbox range ${start}..${end}`);
  }
  let acc: Uint8Array = p.accFrom;
  p.entries.forEach((e, i) => {
    acc = inboxAccumulate({
      ...env,
      prevAcc: acc,
      sequence: start + BigInt(i) + 1n,
      height: e.height,
      poster: e.poster,
      dataHash: postedDataHash(e.payload),
    });
  });
  const want = inboxRangeHash({ ...env, from: start, to: end, accFrom: p.accFrom, accTo: acc });
  if (bytesToHex(want) !== bytesToHex(toBytes(claim.dataHash))) {
    throw new Error("qledger: the fraud proof does not apply: the entries do not hash to the batch's inbox range");
  }
  const prev = toBytes(claim.prevStateRoot);
  if (prev.length !== 32) throw new Error("qledger: the fraud proof does not apply: the batch has no 32-byte parent root");
  const res = executeQledger(env, new QledgerPartialTree(prev, p.witnesses), p.entries);
  return (
    bytesToHex(res.stateRoot) !== bytesToHex(toBytes(claim.stateRoot)) ||
    bytesToHex(res.withdrawalsRoot) !== bytesToHex(toBytes(claim.withdrawalsRoot))
  );
}
