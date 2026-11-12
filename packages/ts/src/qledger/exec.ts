/**
 * qledger-v1 execution: what a batch's state root and withdrawals root must be
 * for the inbox entries it consumes. The chain re-runs exactly this in a fraud
 * proof, so a submitter that publishes anything else loses its bond.
 *
 * Entries that do not parse, carry a bad signature, the wrong nonce, a zero
 * amount, more than the balance, or a non-canonical recipient are no-ops: an
 * open inbox must accept anything without making a batch invalid.
 */
import { bech32 } from "bech32";
import { sha256 } from "@noble/hashes/sha256";
import { qorehash } from "../utils/qorehash";
import {
  QLEDGER_DEPOSIT_POSTER_PREFIX,
  QLEDGER_KIND_TRANSFER,
  QLEDGER_KIND_WITHDRAW,
  be64,
  decodeQledgerDeposit,
  decodeQledgerTx,
  qledgerAccountId,
  verifyQledgerTx,
} from "./tx";
import type { QledgerState } from "./smt";

const MAX_U64 = (1n << 64n) - 1n;
const MAX_I64 = (1n << 63n) - 1n;
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The denom every qledger-v1 withdrawal pays. */
export const QLEDGER_WITHDRAWAL_DENOM = "uqor";

/**
 * The reserved state slot holding the rollup's next withdrawal index (in its
 * balance). Withdrawal indices are global to the rollup.
 */
export const QLEDGER_WITHDRAWAL_COUNTER_ID: Uint8Array = sha256(utf8("qledger/v1/withdrawal-counter"));

/** One inbox entry a batch consumes. */
export interface QledgerEntry {
  /** The height of the block that included the post. */
  height: bigint | number;
  /** The poster address, or `"deposit:" + depositor` for a deposit. */
  poster: string;
  payload: Uint8Array;
}

/** One withdrawal a batch commits, at its global index. */
export interface QledgerWithdrawal {
  index: bigint;
  recipient: string;
  amount: bigint;
}

/** What a batch must publish. */
export interface QledgerResult {
  stateRoot: Uint8Array;
  withdrawals: QledgerWithdrawal[];
  /** Empty when the batch has no withdrawal. */
  withdrawalsRoot: Uint8Array;
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Whether `s` is a `qor1` account address in canonical (lowercase, re-encoding) form. */
export function isCanonicalQorAddress(s: string): boolean {
  try {
    const d = bech32.decode(s, 1023);
    if (d.prefix !== "qor") return false;
    const data = bech32.fromWords(d.words);
    if (data.length === 0 || data.length > 255) return false;
    return bech32.encode("qor", d.words, 1023) === s;
  } catch {
    return false;
  }
}

/**
 * Apply `entries` to `state` in order and return the roots the batch must
 * publish. Throws only when `state` cannot serve an account (a partial tree
 * missing a witness).
 */
export function executeQledger(
  env: { chainId: string; rollupId: string },
  state: QledgerState,
  entries: QledgerEntry[],
): QledgerResult {
  const withdrawals: QledgerWithdrawal[] = [];
  for (const e of entries) {
    if (e.poster.startsWith(QLEDGER_DEPOSIT_POSTER_PREFIX)) {
      const dep = decodeQledgerDeposit(e.payload);
      if (!dep || eq(dep.account, QLEDGER_WITHDRAWAL_COUNTER_ID)) continue;
      const a = state.get(dep.account);
      if (a.balance > MAX_U64 - dep.amount) continue;
      state.set(dep.account, a.balance + dep.amount, a.nonce);
      continue;
    }
    const tx = decodeQledgerTx(e.payload);
    if (!tx || !verifyQledgerTx(tx, env.chainId, env.rollupId)) continue;
    const from = qledgerAccountId(tx.publicKey, tx.scheme);
    const { balance, nonce } = state.get(from);
    if (tx.nonce !== nonce || tx.amount === 0n || balance < tx.amount || nonce === MAX_U64) continue;
    if (tx.kind === QLEDGER_KIND_TRANSFER) {
      const to = tx.to!;
      if (eq(to, QLEDGER_WITHDRAWAL_COUNTER_ID)) continue;
      if (eq(to, from)) {
        state.set(from, balance, nonce + 1n);
        continue;
      }
      const t = state.get(to);
      if (t.balance > MAX_U64 - tx.amount) continue;
      state.set(from, balance - tx.amount, nonce + 1n);
      state.set(to, t.balance + tx.amount, t.nonce);
    } else if (tx.kind === QLEDGER_KIND_WITHDRAW) {
      // Bytes that are not valid UTF-8 can never be a canonical address.
      const raw = tx.recipientBytes ?? utf8(tx.recipient ?? "");
      const validUtf8 = eq(utf8(tx.recipient ?? ""), raw);
      if (tx.amount > MAX_I64 || !validUtf8 || !isCanonicalQorAddress(tx.recipient!)) continue;
      const next = state.get(QLEDGER_WITHDRAWAL_COUNTER_ID).balance;
      if (next === MAX_U64) continue;
      state.set(from, balance - tx.amount, nonce + 1n);
      state.set(QLEDGER_WITHDRAWAL_COUNTER_ID, next + 1n, 0n);
      withdrawals.push({ index: next, recipient: tx.recipient!, amount: tx.amount });
    }
  }
  return {
    stateRoot: state.root(),
    withdrawals,
    withdrawalsRoot: qledgerWithdrawalsRoot(env.chainId, env.rollupId, withdrawals),
  };
}

function lp(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, false);
  out.set(b, 4);
  return out;
}

/** The chain's v2 withdrawal leaf (SHAKE-256, every field length-prefixed). */
export function qledgerWithdrawalLeaf(
  chainId: string,
  rollupId: string,
  index: bigint,
  recipient: string,
  amount: bigint,
): Uint8Array {
  return qorehash(
    lp(utf8("qorechain-rdk-withdrawal/v2")),
    lp(utf8(chainId)),
    lp(utf8(rollupId)),
    be64(index),
    lp(utf8(recipient)),
    lp(utf8(QLEDGER_WITHDRAWAL_DENOM)),
    be64(amount),
  );
}

function levels(chainId: string, rollupId: string, ws: QledgerWithdrawal[]): Uint8Array[][] | undefined {
  if (ws.length === 0) return undefined;
  let n = 1;
  while (n < ws.length) n *= 2;
  // Consecutive global indices: positions index mod n are distinct.
  let level: Uint8Array[] = Array.from({ length: n }, () => new Uint8Array(32));
  for (const w of ws) level[Number(w.index % BigInt(n))] = qledgerWithdrawalLeaf(chainId, rollupId, w.index, w.recipient, w.amount);
  const out = [level];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length / 2; i++) next.push(qorehash(level[2 * i]!, level[2 * i + 1]!));
    out.push(next);
    level = next;
  }
  return out;
}

/**
 * A qledger-v1 batch's withdrawals root: its withdrawals in a tree of the next
 * power of two, each at its global index modulo that size, the rest zero;
 * empty when there is none.
 */
export function qledgerWithdrawalsRoot(chainId: string, rollupId: string, ws: QledgerWithdrawal[]): Uint8Array {
  const l = levels(chainId, rollupId, ws);
  return l ? l[l.length - 1]![0]!.slice() : new Uint8Array();
}

/** The sibling path of withdrawal `i` of a batch, as `MsgExecuteWithdrawal` takes it. */
export function qledgerWithdrawalProof(chainId: string, rollupId: string, ws: QledgerWithdrawal[], i: number): Uint8Array[] {
  const l = levels(chainId, rollupId, ws);
  if (!l || i < 0 || i >= ws.length) throw new Error("qledger: no such withdrawal");
  let idx = Number(ws[i]!.index % BigInt(l[0]!.length));
  const path: Uint8Array[] = [];
  for (const level of l.slice(0, -1)) {
    path.push(level[idx ^ 1]!.slice());
    idx >>= 1;
  }
  return path;
}
