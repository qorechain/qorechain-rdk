"""Binary Merkle root/proof against the golden fixtures."""

from __future__ import annotations

import hashlib

from qorrdk import (
    MerkleOptions,
    assemble_withdrawal_proof,
    binary_merkle_proof,
    binary_merkle_root,
    verify_binary_merkle_proof,
)


def _leaves(golden):
    return [bytes.fromhex(h) for h in golden["merkle"]["leavesHex"]]


def test_merkle_root_matches_golden(golden):
    root = binary_merkle_root(_leaves(golden))
    assert root.hex() == golden["merkle"]["root"]


def test_merkle_proof_index1_siblings_match_golden(golden):
    proof = binary_merkle_proof(_leaves(golden), 1)
    assert [s.hex() for s in proof.siblings] == golden["merkle"]["proofIndex1Siblings"]
    assert proof.root.hex() == golden["merkle"]["root"]


def test_proof_verifies_for_each_leaf(golden):
    leaves = _leaves(golden)
    root = binary_merkle_root(leaves)
    for i, leaf in enumerate(leaves):
        proof = binary_merkle_proof(leaves, i)
        assert verify_binary_merkle_proof(leaf, i, proof.siblings, root)


def test_tampered_proof_fails(golden):
    leaves = _leaves(golden)
    root = binary_merkle_root(leaves)
    proof = binary_merkle_proof(leaves, 1)
    assert not verify_binary_merkle_proof(leaves[0], 1, proof.siblings, root)


def test_sha256_still_available_explicitly(golden):
    """Releases before 0.7.0 defaulted to SHA-256; it can still be chosen."""
    sha256 = MerkleOptions(hash=lambda d: hashlib.sha256(d).digest())
    leaves = _leaves(golden)
    legacy = golden["merkle"]["sha256Legacy"]
    assert binary_merkle_root(leaves, sha256).hex() == legacy["root"]
    proof = binary_merkle_proof(leaves, 1, sha256)
    assert [s.hex() for s in proof.siblings] == legacy["proofIndex1Siblings"]
    assert verify_binary_merkle_proof(leaves[1], 1, proof.siblings, proof.root, sha256)


def test_assemble_withdrawal_proof(golden):
    leaves = [hashlib.sha256(bytes([i])).digest() for i in range(1, 5)]
    wp = assemble_withdrawal_proof(leaves, 1)
    assert wp.withdrawal_index == 1
    # The chain's tree does not re-hash leaves: verify the same way.
    chain = MerkleOptions(hash_leaves=False)
    assert verify_binary_merkle_proof(leaves[1], 1, wp.proof, wp.withdrawals_root, chain)
    assert not verify_binary_merkle_proof(leaves[1], 1, wp.proof, wp.withdrawals_root)


def test_assemble_withdrawal_proof_generic_options_match_golden(golden):
    wp = assemble_withdrawal_proof(_leaves(golden), 1, MerkleOptions())
    assert wp.withdrawals_root.hex() == golden["merkle"]["root"]
    assert [s.hex() for s in wp.proof] == golden["merkle"]["proofIndex1Siblings"]
