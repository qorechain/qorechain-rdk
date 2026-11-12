/**
 * The qledger-v1 state tree: a sparse Merkle tree of depth 256 over account
 * ids (SHA-256), one level per bit, most significant bit first.
 *
 * ```
 * empty leaf = SHA-256(0x00 | "qledger/v1/empty")
 * leaf       = SHA-256(0x00 | id[32] | be64(balance) | be64(nonce))   (empty leaf when both are 0)
 * node       = SHA-256(0x01 | left | right)
 * ```
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "../utils/bytes";
import { be64 } from "./tx";

export const QLEDGER_DEPTH = 256;

const EMPTY: Uint8Array[] = (() => {
  const e: Uint8Array[] = [sha256(new Uint8Array([0x00, ...new TextEncoder().encode("qledger/v1/empty")]))];
  for (let h = 1; h <= QLEDGER_DEPTH; h++) e.push(hashNode(e[h - 1]!, e[h - 1]!));
  return e;
})();

function hashNode(l: Uint8Array, r: Uint8Array): Uint8Array {
  const b = new Uint8Array(65);
  b[0] = 0x01;
  b.set(l, 1);
  b.set(r, 33);
  return sha256(b);
}

/** The root of an empty subtree of height `h` (0 = the empty leaf). */
export function qledgerEmptyHash(h: number): Uint8Array {
  return EMPTY[h]!.slice();
}

/** The state root of a ledger with no account: the parent root of a rollup's first batch. */
export function qledgerEmptyRoot(): Uint8Array {
  return qledgerEmptyHash(QLEDGER_DEPTH);
}

/** The leaf of an account (the empty leaf for a zero account). */
export function qledgerLeafHash(id: Uint8Array, balance: bigint, nonce: bigint): Uint8Array {
  if (balance === 0n && nonce === 0n) return EMPTY[0]!.slice();
  const b = new Uint8Array(49);
  b.set(id, 1);
  b.set(be64(balance), 33);
  b.set(be64(nonce), 41);
  return sha256(b);
}

function bit(id: Uint8Array, i: number): number {
  return (id[i >> 3]! >> (7 - (i & 7))) & 1;
}

/** Opens one account against a state root. Siblings run leaf to root, only the non-empty ones, flagged in `bitmap` (bit d-1 for depth d, MSB first). */
export interface QledgerWitness {
  id: Uint8Array;
  balance: bigint;
  nonce: bigint;
  bitmap: Uint8Array;
  siblings: Uint8Array[];
}

/** What execution reads and writes. */
export interface QledgerState {
  get(id: Uint8Array): { balance: bigint; nonce: bigint };
  set(id: Uint8Array, balance: bigint, nonce: bigint): void;
  root(): Uint8Array;
}

/** Thrown when execution touches an account a partial tree does not hold. */
export class QledgerIncompleteWitnessError extends Error {
  constructor() {
    super("qledger: the witness does not open an account the batch touches");
  }
}

/**
 * A whole qledger-v1 state in memory: what a submitter or a challenger keeps,
 * and what builds witnesses. Zero accounts are not stored, so the root is
 * unique for a state.
 */
export class QledgerLedger implements QledgerState {
  private readonly accts = new Map<string, { id: Uint8Array; balance: bigint; nonce: bigint }>();

  get(id: Uint8Array): { balance: bigint; nonce: bigint } {
    const a = this.accts.get(bytesToHex(id));
    return a ? { balance: a.balance, nonce: a.nonce } : { balance: 0n, nonce: 0n };
  }

  set(id: Uint8Array, balance: bigint, nonce: bigint): void {
    const k = bytesToHex(id);
    if (balance === 0n && nonce === 0n) this.accts.delete(k);
    else this.accts.set(k, { id: id.slice(), balance, nonce });
  }

  clone(): QledgerLedger {
    const c = new QledgerLedger();
    for (const a of this.accts.values()) c.set(a.id, a.balance, a.nonce);
    return c;
  }

  /** Every non-zero account, sorted by id. */
  accounts(): { id: Uint8Array; balance: bigint; nonce: bigint }[] {
    return [...this.accts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => ({ ...v, id: v.id.slice() }));
  }

  private subtree(d: number, ids: Uint8Array[]): Uint8Array {
    if (ids.length === 0) return EMPTY[QLEDGER_DEPTH - d]!;
    if (ids.length === 1) {
      const id = ids[0]!;
      const a = this.get(id);
      let cur = qledgerLeafHash(id, a.balance, a.nonce);
      for (let dd = QLEDGER_DEPTH; dd > d; dd--) {
        cur = bit(id, dd - 1) === 0 ? hashNode(cur, EMPTY[QLEDGER_DEPTH - dd]!) : hashNode(EMPTY[QLEDGER_DEPTH - dd]!, cur);
      }
      return cur;
    }
    const left: Uint8Array[] = [];
    const right: Uint8Array[] = [];
    for (const id of ids) (bit(id, d) === 0 ? left : right).push(id);
    return hashNode(this.subtree(d + 1, left), this.subtree(d + 1, right));
  }

  root(): Uint8Array {
    return this.subtree(0, this.accounts().map((a) => a.id));
  }

  /** A witness for `id` (present or not) against {@link root}. */
  witness(id: Uint8Array): QledgerWitness {
    const a = this.get(id);
    const bitmap = new Uint8Array(32);
    const sibsTopDown: { d: number; h: Uint8Array }[] = [];
    let ids = this.accounts().map((x) => x.id);
    // Walk down from the root: at each depth d (1..256) the sibling of id's
    // node is the subtree on the other side of bit d-1.
    for (let d = 1; d <= QLEDGER_DEPTH; d++) {
      const same: Uint8Array[] = [];
      const other: Uint8Array[] = [];
      for (const x of ids) (bit(x, d - 1) === bit(id, d - 1) ? same : other).push(x);
      const sib = this.subtree(d, other);
      if (other.length > 0) sibsTopDown.push({ d, h: sib });
      ids = same;
    }
    const siblings: Uint8Array[] = [];
    for (const { d, h } of sibsTopDown.reverse()) {
      bitmap[(d - 1) >> 3]! |= 1 << (7 - ((d - 1) & 7));
      siblings.push(h);
    }
    return { id: id.slice(), balance: a.balance, nonce: a.nonce, bitmap, siblings };
  }
}

/**
 * The part of a state tree a set of witnesses opens, checked against a root
 * (what the chain builds from a fraud proof). Reading an account outside it
 * throws {@link QledgerIncompleteWitnessError}.
 */
export class QledgerPartialTree implements QledgerState {
  private readonly nodes = new Map<string, Uint8Array>();
  private readonly accts = new Map<string, { balance: bigint; nonce: bigint }>();
  private current: Uint8Array;

  constructor(root: Uint8Array, witnesses: QledgerWitness[]) {
    this.current = root.slice();
    const put = (k: string, v: Uint8Array) => {
      const old = this.nodes.get(k);
      if (old && bytesToHex(old) !== bytesToHex(v)) throw new Error("qledger: witness does not match the state root");
      this.nodes.set(k, v);
    };
    for (const w of witnesses) {
      let cur = qledgerLeafHash(w.id, w.balance, w.nonce);
      put(keyOf(w.id, QLEDGER_DEPTH), cur);
      let si = 0;
      for (let d = QLEDGER_DEPTH; d >= 1; d--) {
        let sib = EMPTY[QLEDGER_DEPTH - d]!;
        if ((w.bitmap[(d - 1) >> 3]! >> (7 - ((d - 1) & 7))) & 1) {
          if (si >= w.siblings.length) throw new Error("qledger: witness does not match the state root");
          sib = w.siblings[si++]!;
        }
        put(sibKey(w.id, d), sib);
        cur = bit(w.id, d - 1) === 0 ? hashNode(cur, sib) : hashNode(sib, cur);
        put(keyOf(w.id, d - 1), cur);
      }
      if (si !== w.siblings.length || bytesToHex(cur) !== bytesToHex(root)) {
        throw new Error("qledger: witness does not match the state root");
      }
      this.accts.set(bytesToHex(w.id), { balance: w.balance, nonce: w.nonce });
    }
  }

  get(id: Uint8Array): { balance: bigint; nonce: bigint } {
    const a = this.accts.get(bytesToHex(id));
    if (!a) throw new QledgerIncompleteWitnessError();
    return { ...a };
  }

  set(id: Uint8Array, balance: bigint, nonce: bigint): void {
    if (!this.accts.has(bytesToHex(id))) throw new QledgerIncompleteWitnessError();
    this.accts.set(bytesToHex(id), { balance, nonce });
    let cur = qledgerLeafHash(id, balance, nonce);
    this.nodes.set(keyOf(id, QLEDGER_DEPTH), cur);
    for (let d = QLEDGER_DEPTH; d >= 1; d--) {
      const sib = this.nodes.get(sibKey(id, d));
      if (!sib) throw new QledgerIncompleteWitnessError();
      cur = bit(id, d - 1) === 0 ? hashNode(cur, sib) : hashNode(sib, cur);
      this.nodes.set(keyOf(id, d - 1), cur);
    }
    this.current = cur;
  }

  root(): Uint8Array {
    return this.current.slice();
  }
}

function keyOf(id: Uint8Array, d: number): string {
  const p = new Uint8Array(32);
  p.set(id.subarray(0, d >> 3));
  if (d & 7) p[d >> 3] = id[d >> 3]! & (0xff << (8 - (d & 7)));
  return `${d}:${bytesToHex(p)}`;
}

function sibKey(id: Uint8Array, d: number): string {
  const f = id.slice();
  f[(d - 1) >> 3]! ^= 1 << (7 - ((d - 1) & 7));
  return keyOf(f, d);
}
