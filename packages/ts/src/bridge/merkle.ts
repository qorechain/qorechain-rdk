/**
 * Generic binary Merkle tree utilities for assembling withdrawal proofs.
 *
 * An `rdk` settlement batch commits its L2→L1 messages (withdrawals) as a binary
 * Merkle root (`withdrawals_root`), and `MsgExecuteWithdrawal` carries the sibling
 * hashes from a leaf to that root. These helpers build the root and a leaf's
 * proof.
 *
 * IMPORTANT: the leaf encoding, hash function, and odd-node handling MUST match
 * the network's `withdrawals_root` construction for the proof to verify on-chain.
 * The defaults here (SHA-256, hash each leaf, duplicate the last node on odd
 * levels, no domain separation) are a common convention — override `options` to
 * match the chain exactly.
 */
import { sha256 } from "@cosmjs/crypto";

export interface MerkleOptions {
  /** Hash function for internal nodes (and leaves when `hashLeaves`). Default SHA-256. */
  hash?: (data: Uint8Array) => Uint8Array;
  /** Hash each input leaf before building the tree. Default true. */
  hashLeaves?: boolean;
  /** On an odd number of nodes, duplicate the last one. Default true. */
  duplicateOdd?: boolean;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function resolved(options: MerkleOptions = {}): Required<MerkleOptions> {
  return {
    hash: options.hash ?? sha256,
    hashLeaves: options.hashLeaves ?? true,
    duplicateOdd: options.duplicateOdd ?? true,
  };
}

function leafNodes(leaves: Uint8Array[], opts: Required<MerkleOptions>): Uint8Array[] {
  return opts.hashLeaves ? leaves.map((l) => opts.hash(l)) : leaves.slice();
}

/** Compute the binary Merkle root of a list of leaves. */
export function binaryMerkleRoot(leaves: Uint8Array[], options?: MerkleOptions): Uint8Array {
  const opts = resolved(options);
  if (leaves.length === 0) {
    return opts.hash(new Uint8Array());
  }
  let level = leafNodes(leaves, opts);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : opts.duplicateOdd ? level[i] : undefined;
      next.push(right ? opts.hash(concat(left, right)) : left);
    }
    level = next;
  }
  return level[0];
}

/** A leaf's Merkle proof: the sibling hashes from the leaf up to the root. */
export interface MerkleProof {
  /** Sibling hashes, leaf level first. */
  siblings: Uint8Array[];
  /** The computed root. */
  root: Uint8Array;
  /** The leaf index the proof is for. */
  index: number;
}

/** Build the Merkle proof (sibling path) for the leaf at `index`. */
export function binaryMerkleProof(
  leaves: Uint8Array[],
  index: number,
  options?: MerkleOptions,
): MerkleProof {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`leaf index ${index} out of range (0..${leaves.length - 1})`);
  }
  const opts = resolved(options);
  const siblings: Uint8Array[] = [];
  let level = leafNodes(leaves, opts);
  let idx = index;
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    if (siblingIdx < level.length) {
      siblings.push(level[siblingIdx]);
    } else if (opts.duplicateOdd) {
      siblings.push(level[idx]);
    }
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : opts.duplicateOdd ? level[i] : undefined;
      next.push(right ? opts.hash(concat(left, right)) : left);
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return { siblings, root: level[0], index };
}

/** Verify a leaf against a Merkle root using a sibling path. */
export function verifyBinaryMerkleProof(
  leaf: Uint8Array,
  index: number,
  siblings: Uint8Array[],
  root: Uint8Array,
  options?: MerkleOptions,
): boolean {
  const opts = resolved(options);
  let node = opts.hashLeaves ? opts.hash(leaf) : leaf;
  let idx = index;
  for (const sibling of siblings) {
    const isRight = idx % 2 === 1;
    node = isRight ? opts.hash(concat(sibling, node)) : opts.hash(concat(node, sibling));
    idx = Math.floor(idx / 2);
  }
  if (node.length !== root.length) return false;
  for (let i = 0; i < node.length; i++) {
    if (node[i] !== root[i]) return false;
  }
  return true;
}
