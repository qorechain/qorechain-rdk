/**
 * QoreChain's default hash: SHAKE-256 with a 32-byte output (the chain's
 * `qorehash.Sum256`). Merkle nodes, withdrawal leaves, DA blob commitments and
 * transition roots all use it.
 */
import { shake256 } from "@noble/hashes/sha3";

/** SHAKE-256 of the concatenation of `parts`, 32 bytes. */
export function qorehash(...parts: Uint8Array[]): Uint8Array {
  const h = shake256.create({ dkLen: 32 });
  for (const p of parts) h.update(p);
  return h.digest();
}
