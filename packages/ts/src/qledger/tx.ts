/**
 * qledger-v1 transactions and deposits (chain v3.2.8+, `rdk-optimistic-reexec`).
 *
 * A qledger-v1 rollup is a uqor account ledger. Its inputs are the rollup's
 * inbox entries: user posts carrying one signed transaction each, and deposit
 * entries the chain appends for `MsgDepositToRollup`.
 *
 * ```
 * tx       = 0x01 | scheme | public_key | kind | be64(nonce) | body | be64(amount) | signature
 * transfer = to[32]
 * withdraw = u8(len) | recipient (bech32)
 * ```
 *
 * The only scheme is ML-DSA-44 (`scheme` 1), signed deterministically with the
 * FIPS 204 context `"qledger/v1"` over
 * `SHA-256("qledger/v1/tx" | lp(chain_id) | lp(rollup_id) | unsigned)`.
 */
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha256";
import { toBytes } from "../utils/bytes";

/** ML-DSA-44, the only qledger-v1 account scheme. */
export const QLEDGER_SCHEME_MLDSA44 = 1;
/** Transaction kinds. */
export const QLEDGER_KIND_TRANSFER = 1;
export const QLEDGER_KIND_WITHDRAW = 2;
/** Longest withdrawal recipient (a bech32 address). */
export const QLEDGER_MAX_RECIPIENT_LEN = 90;
/** Poster prefix of the inbox entries the chain writes for deposits. */
export const QLEDGER_DEPOSIT_POSTER_PREFIX = "deposit:";

const TX_VERSION = 1;
const MLDSA44_PUBLIC_KEY_SIZE = 1312;
const MLDSA44_SIGNATURE_SIZE = 2420;
const CONTEXT = new TextEncoder().encode("qledger/v1");
const DEPOSIT_MAGIC = new TextEncoder().encode("QLDP");
const utf8 = (s: string) => new TextEncoder().encode(s);

/** A qledger-v1 transaction. `to` is set for a transfer, `recipient` for a withdrawal. */
export interface QledgerTx {
  scheme: number;
  publicKey: Uint8Array;
  kind: number;
  nonce: bigint;
  to?: Uint8Array;
  recipient?: string;
  /**
   * The recipient's bytes exactly as posted. Set by `decodeQledgerTx`; the
   * signature covers these bytes, which differ from `recipient` only when they
   * are not valid UTF-8 (such a withdrawal is a no-op on chain, but its
   * signature still verifies and its sender is still read).
   */
  recipientBytes?: Uint8Array;
  amount: bigint;
  signature: Uint8Array;
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

export function be64(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, false);
  return b;
}

function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, false);
  return b;
}

/** The account id a public key controls: `SHA-256("qledger/v1/account" | scheme | public_key)`. */
export function qledgerAccountId(publicKey: Uint8Array | string, scheme = QLEDGER_SCHEME_MLDSA44): Uint8Array {
  return sha256(concat([utf8("qledger/v1/account"), new Uint8Array([scheme]), toBytes(publicKey)]));
}

/** An ML-DSA-44 account key pair from a 32-byte seed, and its account id. */
export function qledgerKeypairFromSeed(seed: Uint8Array | string): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  accountId: Uint8Array;
} {
  const s = toBytes(seed);
  if (s.length !== 32) throw new Error(`qledger: an ML-DSA-44 seed is 32 bytes, got ${s.length}`);
  const { publicKey, secretKey } = ml_dsa44.keygen(s);
  return { publicKey, secretKey, accountId: qledgerAccountId(publicKey) };
}

/** The encoding without the signature. */
export function qledgerTxUnsigned(tx: Omit<QledgerTx, "signature">): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([TX_VERSION, tx.scheme]), tx.publicKey, new Uint8Array([tx.kind]), be64(tx.nonce)];
  if (tx.kind === QLEDGER_KIND_TRANSFER) {
    const to = tx.to ?? new Uint8Array(32);
    if (to.length !== 32) throw new Error("qledger: a transfer's `to` is a 32-byte account id");
    parts.push(to);
  } else if (tx.kind === QLEDGER_KIND_WITHDRAW) {
    const r = tx.recipientBytes ?? utf8(tx.recipient ?? "");
    if (r.length > 255) throw new Error("qledger: recipient too long");
    parts.push(new Uint8Array([r.length]), r);
  }
  parts.push(be64(tx.amount));
  return concat(parts);
}

/** The transaction as posted. */
export function encodeQledgerTx(tx: QledgerTx): Uint8Array {
  return concat([qledgerTxUnsigned(tx), tx.signature]);
}

/** What an account signs: the transaction bound to one chain and one rollup. */
export function qledgerSigningMessage(chainId: string, rollupId: string, unsigned: Uint8Array): Uint8Array {
  const c = utf8(chainId);
  const r = utf8(rollupId);
  return sha256(concat([utf8("qledger/v1/tx"), u32(c.length), c, u32(r.length), r, unsigned]));
}

/**
 * Build and sign (deterministically) a transfer or withdrawal. Post the
 * result with `postRollupData`; one transaction per post.
 */
export function signQledgerTx(input: {
  chainId: string;
  rollupId: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  nonce: bigint | number;
  amount: bigint | number;
  /** A transfer to this 32-byte account id. */
  to?: Uint8Array | string;
  /** Or a withdrawal to this canonical `qor1` address. */
  recipient?: string;
}): QledgerTx {
  if ((input.to === undefined) === (input.recipient === undefined)) {
    throw new Error("qledger: give exactly one of `to` (transfer) or `recipient` (withdrawal)");
  }
  if (input.recipient !== undefined) {
    const n = utf8(input.recipient).length;
    if (n === 0 || n > QLEDGER_MAX_RECIPIENT_LEN) {
      throw new Error(`qledger: a recipient is 1 to ${QLEDGER_MAX_RECIPIENT_LEN} bytes; the chain would ignore this withdrawal`);
    }
  }
  const tx: Omit<QledgerTx, "signature"> = {
    scheme: QLEDGER_SCHEME_MLDSA44,
    publicKey: input.publicKey,
    kind: input.to !== undefined ? QLEDGER_KIND_TRANSFER : QLEDGER_KIND_WITHDRAW,
    nonce: BigInt(input.nonce),
    amount: BigInt(input.amount),
    ...(input.to !== undefined ? { to: toBytes(input.to) } : { recipient: input.recipient }),
  };
  const msg = qledgerSigningMessage(input.chainId, input.rollupId, qledgerTxUnsigned(tx));
  const signature = ml_dsa44.sign(msg, input.secretKey, { context: CONTEXT, extraEntropy: false });
  return { ...tx, signature };
}

/** Parse a posted payload; `undefined` for anything that is not exactly one well-formed transaction. */
export function decodeQledgerTx(input: Uint8Array | string): QledgerTx | undefined {
  const b = toBytes(input);
  if (b.length < 2 || b[0] !== TX_VERSION || b[1] !== QLEDGER_SCHEME_MLDSA44) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  if (b.length < p + MLDSA44_PUBLIC_KEY_SIZE + 1 + 8) return undefined;
  const publicKey = b.slice(p, p + MLDSA44_PUBLIC_KEY_SIZE);
  p += MLDSA44_PUBLIC_KEY_SIZE;
  const kind = b[p]!;
  p += 1;
  const nonce = dv.getBigUint64(p, false);
  p += 8;
  let to: Uint8Array | undefined;
  let recipient: string | undefined;
  let recipientBytes: Uint8Array | undefined;
  if (kind === QLEDGER_KIND_TRANSFER) {
    if (b.length < p + 32) return undefined;
    to = b.slice(p, p + 32);
    p += 32;
  } else if (kind === QLEDGER_KIND_WITHDRAW) {
    if (b.length < p + 1) return undefined;
    const n = b[p]!;
    p += 1;
    if (n === 0 || n > QLEDGER_MAX_RECIPIENT_LEN || b.length < p + n) return undefined;
    recipientBytes = b.slice(p, p + n);
    recipient = new TextDecoder().decode(recipientBytes);
    p += n;
  } else {
    return undefined;
  }
  if (b.length !== p + 8 + MLDSA44_SIGNATURE_SIZE) return undefined;
  const amount = dv.getBigUint64(p, false);
  p += 8;
  return { scheme: QLEDGER_SCHEME_MLDSA44, publicKey, kind, nonce, to, recipient, recipientBytes, amount, signature: b.slice(p) };
}

/** Whether `tx` carries a valid signature for `chainId` / `rollupId`. */
export function verifyQledgerTx(tx: QledgerTx, chainId: string, rollupId: string): boolean {
  if (
    tx.scheme !== QLEDGER_SCHEME_MLDSA44 ||
    tx.publicKey.length !== MLDSA44_PUBLIC_KEY_SIZE ||
    tx.signature.length !== MLDSA44_SIGNATURE_SIZE
  ) {
    return false;
  }
  const msg = qledgerSigningMessage(chainId, rollupId, qledgerTxUnsigned(tx));
  try {
    return ml_dsa44.verify(tx.signature, msg, tx.publicKey, { context: CONTEXT });
  } catch {
    return false;
  }
}

/** The payload of a deposit entry: `"QLDP" | account[32] | be64(amount)`. */
export function encodeQledgerDeposit(account: Uint8Array | string, amount: bigint | number): Uint8Array {
  const a = toBytes(account);
  if (a.length !== 32) throw new Error("qledger: an account id is 32 bytes");
  return concat([DEPOSIT_MAGIC, a, be64(BigInt(amount))]);
}

/** Parse a deposit payload. */
export function decodeQledgerDeposit(input: Uint8Array | string): { account: Uint8Array; amount: bigint } | undefined {
  const b = toBytes(input);
  if (b.length !== 44 || !DEPOSIT_MAGIC.every((x, i) => b[i] === x)) return undefined;
  return { account: b.slice(4, 36), amount: new DataView(b.buffer, b.byteOffset).getBigUint64(36, false) };
}
