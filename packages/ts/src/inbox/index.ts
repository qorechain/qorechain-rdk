/**
 * Posted rollup data and the rollup inbox (chain v3.2.8+).
 *
 * `MsgPostRollupData` gives each post the next inbox sequence (from 1) and
 * extends the rollup's inbox accumulator:
 *
 * ```
 * acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp(chain_id) | lp(rollup_id) | acc_{n-1}
 *                 | be64(n) | be64(height) | lp(poster) | SHA-256(data))
 * ```
 *
 * with `acc_0` 32 zero bytes and `lp` a 4-byte big-endian length prefix. A
 * batch of a based rollup sets `inbox_end` and carries as `data_hash` the
 * range commitment from the consumed position to `inbox_end`:
 *
 * ```
 * range = SHA-256("qorechain/rdk/inbox-range/v1" | lp(chain_id) | lp(rollup_id)
 *                 | be64(from) | be64(to) | acc_from | acc_to)
 * ```
 *
 * The chain returns it too (`RestClient.getInbox(rollupId, inboxEnd)`). A
 * native-DA batch of a rollup that is not based may carry `SHA-256(data)` of a
 * retained post as its `data_hash`.
 */
import { sha256 } from "@noble/hashes/sha256";
import { toBytes } from "../utils/bytes";

const ACC_DOMAIN = new TextEncoder().encode("qorechain/rdk/inbox/v1");
const RANGE_DOMAIN = new TextEncoder().encode("qorechain/rdk/inbox-range/v1");

/** The accumulator of an inbox with no post: 32 zero bytes. */
export const EMPTY_INBOX_ACC = new Uint8Array(32);

function lp(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, false);
  out.set(b, 4);
  return out;
}

function be64(v: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(v), false);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** SHA-256 of a post's payload: the hash a batch references. */
export function postedDataHash(data: Uint8Array | string): Uint8Array {
  return sha256(toBytes(data));
}

/** One step of the inbox accumulator (what the chain stores after post `sequence`). */
export function inboxAccumulate(input: {
  chainId: string;
  rollupId: string;
  /** The accumulator before this post (`EMPTY_INBOX_ACC` for the first). */
  prevAcc: Uint8Array | string;
  sequence: bigint | number;
  /** The height of the block that included the post. */
  height: bigint | number;
  poster: string;
  /** SHA-256 of the payload ({@link postedDataHash}). */
  dataHash: Uint8Array | string;
}): Uint8Array {
  const prev = toBytes(input.prevAcc);
  const h = sha256.create();
  h.update(ACC_DOMAIN);
  h.update(lp(utf8(input.chainId)));
  h.update(lp(utf8(input.rollupId)));
  h.update(prev.length === 0 ? EMPTY_INBOX_ACC : prev);
  h.update(be64(input.sequence));
  h.update(be64(input.height));
  h.update(lp(utf8(input.poster)));
  h.update(toBytes(input.dataHash));
  return h.digest();
}

/**
 * The inbox range commitment a based batch carries as `data_hash`: the posts
 * after `from` (the consumed position) up to `to` (`inbox_end`).
 */
export function inboxRangeHash(input: {
  chainId: string;
  rollupId: string;
  from: bigint | number;
  to: bigint | number;
  accFrom: Uint8Array | string;
  accTo: Uint8Array | string;
}): Uint8Array {
  const accFrom = toBytes(input.accFrom);
  const accTo = toBytes(input.accTo);
  const h = sha256.create();
  h.update(RANGE_DOMAIN);
  h.update(lp(utf8(input.chainId)));
  h.update(lp(utf8(input.rollupId)));
  h.update(be64(input.from));
  h.update(be64(input.to));
  h.update(accFrom.length === 0 ? EMPTY_INBOX_ACC : accFrom);
  h.update(accTo.length === 0 ? EMPTY_INBOX_ACC : accTo);
  return h.digest();
}
