//! Generic binary Merkle tree utilities for assembling withdrawal proofs.
//!
//! An `rdk` settlement batch commits its L2->L1 messages (withdrawals) as a
//! binary Merkle root (`withdrawals_root`), and `MsgExecuteWithdrawal` carries
//! the sibling hashes from a leaf to that root. These helpers build the root and
//! a leaf's proof.
//!
//! The hash defaults to the chain's: SHAKE-256 with a 32-byte output. For a
//! batch's withdrawals use [`crate::bridge::withdrawal::withdrawals_tree`],
//! which also builds the chain's leaves and places each at its withdrawal
//! index; these generic helpers hash each input leaf by default, which the
//! chain does not. Releases before 0.7.0 defaulted to SHA-256, which no chain
//! construction uses.

use crate::utils::qorehash::qorehash;

/// Options controlling tree construction.
#[derive(Debug, Clone, Copy)]
pub struct MerkleOptions {
    /// Hash function for internal nodes (and leaves when `hash_leaves`).
    /// Default SHAKE-256 (32 bytes).
    pub hash: fn(&[u8]) -> Vec<u8>,
    /// Hash each input leaf before building the tree. Default `true`.
    pub hash_leaves: bool,
    /// On an odd number of nodes, duplicate the last one. Default `true`.
    pub duplicate_odd: bool,
}

impl Default for MerkleOptions {
    fn default() -> Self {
        MerkleOptions {
            hash: qorehash_vec,
            hash_leaves: true,
            duplicate_odd: true,
        }
    }
}

impl MerkleOptions {
    /// The chain's tree over already-hashed leaves: SHAKE-256 nodes, leaves
    /// not re-hashed, an odd last node paired with itself.
    pub const fn chain_tree() -> Self {
        MerkleOptions {
            hash: qorehash_vec,
            hash_leaves: false,
            duplicate_odd: true,
        }
    }
}

fn qorehash_vec(data: &[u8]) -> Vec<u8> {
    qorehash(&[data]).to_vec()
}

fn concat_hash(a: &[u8], b: &[u8], opts: MerkleOptions) -> Vec<u8> {
    let mut buf = Vec::with_capacity(a.len() + b.len());
    buf.extend_from_slice(a);
    buf.extend_from_slice(b);
    (opts.hash)(&buf)
}

fn leaf_nodes(leaves: &[Vec<u8>], opts: MerkleOptions) -> Vec<Vec<u8>> {
    if opts.hash_leaves {
        leaves.iter().map(|l| (opts.hash)(l)).collect()
    } else {
        leaves.to_vec()
    }
}

/// Compute the binary Merkle root of a list of leaves.
pub fn binary_merkle_root(leaves: &[Vec<u8>], options: MerkleOptions) -> Vec<u8> {
    if leaves.is_empty() {
        return (options.hash)(&[]);
    }
    let mut level = leaf_nodes(leaves, options);
    while level.len() > 1 {
        let mut next: Vec<Vec<u8>> = Vec::new();
        let mut i = 0;
        while i < level.len() {
            let left = &level[i];
            if i + 1 < level.len() {
                next.push(concat_hash(left, &level[i + 1], options));
            } else if options.duplicate_odd {
                next.push(concat_hash(left, left, options));
            } else {
                next.push(left.clone());
            }
            i += 2;
        }
        level = next;
    }
    level.into_iter().next().unwrap_or_default()
}

/// A leaf's Merkle proof: the sibling hashes from the leaf up to the root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MerkleProof {
    /// Sibling hashes, leaf level first.
    pub siblings: Vec<Vec<u8>>,
    /// The computed root.
    pub root: Vec<u8>,
    /// The leaf index the proof is for.
    pub index: usize,
}

/// Build the Merkle proof (sibling path) for the leaf at `index`.
///
/// # Panics
///
/// Panics if `index` is out of range.
pub fn binary_merkle_proof(
    leaves: &[Vec<u8>],
    index: usize,
    options: MerkleOptions,
) -> MerkleProof {
    assert!(
        index < leaves.len(),
        "leaf index {index} out of range (0..{})",
        leaves.len()
    );
    let mut siblings: Vec<Vec<u8>> = Vec::new();
    let mut level = leaf_nodes(leaves, options);
    let mut idx = index;
    while level.len() > 1 {
        let is_right = idx % 2 == 1;
        let sibling_idx = if is_right { idx - 1 } else { idx + 1 };
        if sibling_idx < level.len() {
            siblings.push(level[sibling_idx].clone());
        } else if options.duplicate_odd {
            siblings.push(level[idx].clone());
        }
        let mut next: Vec<Vec<u8>> = Vec::new();
        let mut i = 0;
        while i < level.len() {
            let left = &level[i];
            if i + 1 < level.len() {
                next.push(concat_hash(left, &level[i + 1], options));
            } else if options.duplicate_odd {
                next.push(concat_hash(left, left, options));
            } else {
                next.push(left.clone());
            }
            i += 2;
        }
        level = next;
        idx /= 2;
    }
    MerkleProof {
        siblings,
        root: level.into_iter().next().unwrap_or_default(),
        index,
    }
}

/// Verify a leaf against a Merkle root using a sibling path.
pub fn verify_binary_merkle_proof(
    leaf: &[u8],
    index: usize,
    siblings: &[Vec<u8>],
    root: &[u8],
    options: MerkleOptions,
) -> bool {
    let mut node = if options.hash_leaves {
        (options.hash)(leaf)
    } else {
        leaf.to_vec()
    };
    let mut idx = index;
    for sibling in siblings {
        let is_right = idx % 2 == 1;
        node = if is_right {
            concat_hash(sibling, &node, options)
        } else {
            concat_hash(&node, sibling, options)
        };
        idx /= 2;
    }
    node == root
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn leaves() -> Vec<Vec<u8>> {
        vec![vec![1], vec![2], vec![3], vec![4]]
    }

    fn sha256(data: &[u8]) -> Vec<u8> {
        Sha256::digest(data).to_vec()
    }

    #[test]
    fn root_and_proof() {
        let opts = MerkleOptions::default();
        let root = binary_merkle_root(&leaves(), opts);
        assert_eq!(
            hex::encode(&root),
            "2ddb9821033b7e9b8a5373831724cc1f531f787ed9460e8029096ef6b9eb8708"
        );
        let proof = binary_merkle_proof(&leaves(), 1, opts);
        assert!(verify_binary_merkle_proof(
            &[2],
            1,
            &proof.siblings,
            &root,
            opts
        ));
    }

    #[test]
    fn sha256_when_asked() {
        let opts = MerkleOptions {
            hash: sha256,
            ..MerkleOptions::default()
        };
        assert_eq!(
            hex::encode(binary_merkle_root(&leaves(), opts)),
            "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d"
        );
    }
}
