/**
 * Private-rollup envelopes (chain v3.2.8+, `rdk-private-rollups`).
 *
 * Every post on a private (`privacy: "encapsulated"`) rollup is an envelope:
 * the data encrypted once with AES-256-GCM under a fresh content key, and that
 * key encapsulated with ML-KEM-1024 to every member's key from the chain's KEM
 * registry, with a key commitment so all members open the same content. The
 * chain checks the envelope's structure and that every entry names a current
 * member's current key; it never decrypts.
 *
 * Posts, poster, timing, sizes, members, roots and withdrawals stay public.
 *
 * Layout (all integers big-endian):
 *
 * ```
 * "QPRV" | 0x01 | be64(epoch) | key_commit(32) | be16(n)
 * n × ( be16(len) | member | fingerprint(32) | kem_ciphertext(1568) | wrapped_key(48) )
 * ciphertext (AES-256-GCM, zero nonce, AAD = everything before it)
 * ```
 */
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { toBytes } from "../utils/bytes";

const MAGIC = new TextEncoder().encode("QPRV");
const VERSION = 1;
/** ML-KEM-1024 ciphertext size. */
export const KEM_CIPHERTEXT_SIZE = 1568;
/** ML-KEM-1024 encapsulation (public) key size. */
export const ENCAPSULATION_KEY_SIZE = 1568;
const WRAPPED_KEY_SIZE = 48;
const MIN_PAYLOAD_SIZE = 16;
/** Most members (envelope entries) a private rollup can have. */
export const MAX_ENVELOPE_MEMBERS = 32;
const MAX_ADDRESS_LEN = 128;
const ZERO_NONCE = new Uint8Array(12);
const utf8 = (s: string) => new TextEncoder().encode(s);

/** One member's entry in an envelope. */
export interface EnvelopeEntry {
  member: string;
  /** SHA-256 of the member's ML-KEM-1024 encapsulation key. */
  fingerprint: Uint8Array;
  kemCiphertext: Uint8Array;
  wrappedKey: Uint8Array;
}

/** A parsed envelope. */
export interface Envelope {
  epoch: bigint;
  keyCommit: Uint8Array;
  entries: EnvelopeEntry[];
  ciphertext: Uint8Array;
  /** Everything before `ciphertext`: the payload's additional data. */
  header: Uint8Array;
}

/** A recipient: a member address and its ML-KEM-1024 encapsulation key. */
export interface EnvelopeRecipient {
  member: string;
  encapsulationKey: Uint8Array | string;
}

/** The fingerprint the chain matches against a member's registered key. */
export function kemKeyFingerprint(encapsulationKey: Uint8Array | string): Uint8Array {
  return sha256(toBytes(encapsulationKey));
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

function u16(v: number): Uint8Array {
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}
function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, false);
  return b;
}
function u64(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, false);
  return b;
}

function wrapKey(sharedSecret: Uint8Array, chainId: string, rollupId: string, epoch: bigint, member: string): Uint8Array {
  const c = utf8(chainId);
  const r = utf8(rollupId);
  const m = utf8(member);
  const info = concat([utf8("qorechain/rdk/private/v1/wrap"), u32(c.length), c, u32(r.length), r, u64(epoch), u32(m.length), m]);
  return hkdf(sha256, sharedSecret, undefined, info, 32);
}

function keyCommit(contentKey: Uint8Array): Uint8Array {
  return sha256(concat([utf8("qorechain/rdk/private/v1/key"), contentKey]));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** Parse an envelope and check every size (not membership: the chain does that). */
export function parseEnvelope(input: Uint8Array | string): Envelope {
  const b = toBytes(input);
  const malformed = (why: string) => new Error(`privpost: malformed envelope: ${why}`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 5 + 8 + 32 + 2 || !equal(b.subarray(0, 4), MAGIC) || b[4] !== VERSION) {
    throw malformed("bad header");
  }
  let p = 5;
  const epoch = dv.getBigUint64(p, false);
  p += 8;
  const keyCommitBytes = b.slice(p, p + 32);
  p += 32;
  const n = dv.getUint16(p, false);
  p += 2;
  if (n === 0 || n > MAX_ENVELOPE_MEMBERS) throw malformed(`${n} entries`);
  const entries: EnvelopeEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (b.length - p < 2) throw malformed("truncated entry");
    const al = dv.getUint16(p, false);
    p += 2;
    if (al === 0 || al > MAX_ADDRESS_LEN || b.length - p < al + 32 + KEM_CIPHERTEXT_SIZE + WRAPPED_KEY_SIZE) {
      throw malformed("truncated entry");
    }
    const member = new TextDecoder().decode(b.subarray(p, p + al));
    p += al;
    const fingerprint = b.slice(p, p + 32);
    p += 32;
    const kemCiphertext = b.slice(p, p + KEM_CIPHERTEXT_SIZE);
    p += KEM_CIPHERTEXT_SIZE;
    const wrappedKey = b.slice(p, p + WRAPPED_KEY_SIZE);
    p += WRAPPED_KEY_SIZE;
    entries.push({ member, fingerprint, kemCiphertext, wrappedKey });
  }
  if (b.length - p < MIN_PAYLOAD_SIZE) throw malformed("payload shorter than its tag");
  return { epoch, keyCommit: keyCommitBytes, entries, ciphertext: b.slice(p), header: b.slice(0, p) };
}

/**
 * Encrypt `plaintext` to `recipients` (in the rollup's member order) for a
 * rollup at its current membership epoch. Post the result with
 * `postRollupDataMsg`.
 *
 * @param opts.random a source of random bytes (defaults to `crypto.getRandomValues`);
 *   pass a deterministic one only in tests.
 */
export function sealEnvelope(input: {
  chainId: string;
  rollupId: string;
  epoch: bigint | number;
  recipients: EnvelopeRecipient[];
  plaintext: Uint8Array | string;
  random?: (n: number) => Uint8Array;
}): Uint8Array {
  const { recipients } = input;
  if (recipients.length === 0 || recipients.length > MAX_ENVELOPE_MEMBERS) {
    throw new Error(`privpost: ${recipients.length} recipients (1 to ${MAX_ENVELOPE_MEMBERS})`);
  }
  const random =
    input.random ??
    ((n: number) => {
      const out = new Uint8Array(n);
      globalThis.crypto.getRandomValues(out);
      return out;
    });
  const epoch = BigInt(input.epoch);
  const contentKey = random(32);
  const parts: Uint8Array[] = [MAGIC, new Uint8Array([VERSION]), u64(epoch), keyCommit(contentKey), u16(recipients.length)];
  for (const r of recipients) {
    const member = utf8(r.member);
    if (member.length === 0 || member.length > MAX_ADDRESS_LEN) throw new Error(`privpost: member "${r.member}"`);
    const ek = toBytes(r.encapsulationKey);
    if (ek.length !== ENCAPSULATION_KEY_SIZE) {
      throw new Error(`privpost: key of ${r.member} is ${ek.length} bytes, want ${ENCAPSULATION_KEY_SIZE}`);
    }
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(ek, random(32));
    const wrapped = gcm(wrapKey(sharedSecret, input.chainId, input.rollupId, epoch, r.member), ZERO_NONCE).encrypt(contentKey);
    parts.push(u16(member.length), member, kemKeyFingerprint(ek), cipherText, wrapped);
  }
  const header = concat(parts);
  const body = gcm(contentKey, ZERO_NONCE, header).encrypt(toBytes(input.plaintext));
  return concat([header, body]);
}

/**
 * An ML-KEM-1024 key pair from a 64-byte seed (`d || z`), the form the chain's
 * tooling stores. The `secretKey` (3168 bytes) or the seed both open envelopes.
 */
export function kemKeypairFromSeed(seed: Uint8Array | string): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const s = toBytes(seed);
  if (s.length !== 64) throw new Error(`privpost: an ML-KEM-1024 seed is 64 bytes, got ${s.length}`);
  return ml_kem1024.keygen(s);
}

/**
 * Decrypt an envelope as `member`. `decapsulationKey` is the 64-byte seed or
 * the 3168-byte expanded secret key.
 *
 * @throws if the member has no entry, the key does not open it, or the content
 *   key does not match the envelope's commitment.
 */
export function openEnvelope(input: {
  envelope: Uint8Array | string;
  chainId: string;
  rollupId: string;
  member: string;
  decapsulationKey: Uint8Array | string;
}): Uint8Array {
  const e = parseEnvelope(input.envelope);
  const dk = toBytes(input.decapsulationKey);
  let secretKey: Uint8Array;
  if (dk.length === 64) secretKey = ml_kem1024.keygen(dk).secretKey;
  else if (dk.length === 3168) secretKey = dk;
  else throw new Error(`privpost: an ML-KEM-1024 key is 64 (seed) or 3168 bytes, got ${dk.length}`);
  const entry = e.entries.find((en) => en.member === input.member);
  if (!entry) throw new Error("privpost: the envelope has no entry for this member");
  const ss = ml_kem1024.decapsulate(entry.kemCiphertext, secretKey);
  let contentKey: Uint8Array;
  try {
    contentKey = gcm(wrapKey(ss, input.chainId, input.rollupId, e.epoch, input.member), ZERO_NONCE).decrypt(
      entry.wrappedKey,
    );
  } catch {
    throw new Error("privpost: the envelope does not open with this key");
  }
  if (!equal(keyCommit(contentKey), e.keyCommit)) {
    throw new Error("privpost: the content key does not match the envelope's commitment");
  }
  try {
    return gcm(contentKey, ZERO_NONCE, e.header).decrypt(e.ciphertext);
  } catch {
    throw new Error("privpost: the envelope does not open with this key");
  }
}

/**
 * Why the chain would refuse `envelope` as a post on a private rollup, or
 * `undefined` if it would accept its structure. Mirrors the chain's check: the
 * envelope's epoch is the rollup's membership epoch, there is one entry per
 * member in the rollup's order, and each entry names that member's registered
 * ML-KEM-1024 key. It does not decrypt.
 */
export function envelopeMembershipError(
  envelope: Uint8Array | string,
  rollup: { membersEpoch: bigint | number; members: { member: string; encapsulationKey: Uint8Array | string }[] },
): string | undefined {
  const { members } = rollup;
  if (members.length === 0) return "the rollup has no members yet";
  let e: Envelope;
  try {
    e = parseEnvelope(envelope);
  } catch (err) {
    return (err as Error).message;
  }
  if (e.epoch !== BigInt(rollup.membersEpoch)) {
    return `envelope epoch ${e.epoch}, the rollup's membership epoch is ${rollup.membersEpoch}`;
  }
  if (e.entries.length !== members.length) {
    return `${e.entries.length} entries for ${members.length} members`;
  }
  for (let i = 0; i < members.length; i++) {
    const want = members[i]!;
    const got = e.entries[i]!;
    if (got.member !== want.member) return `entry ${i} is for ${got.member}, member ${i} is ${want.member}`;
    if (!equal(got.fingerprint, kemKeyFingerprint(want.encapsulationKey))) {
      return `entry ${i} does not name ${want.member}'s registered KEM key`;
    }
  }
  return undefined;
}
