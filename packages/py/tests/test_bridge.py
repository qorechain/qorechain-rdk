"""Binary Merkle root/proof against the golden fixtures."""

from __future__ import annotations

from qorrdk import (
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


def test_assemble_withdrawal_proof(golden):
    leaves = _leaves(golden)
    wp = assemble_withdrawal_proof(leaves, 1)
    assert wp.withdrawal_index == 1
    assert wp.withdrawals_root.hex() == golden["merkle"]["root"]
    assert [s.hex() for s in wp.proof] == golden["merkle"]["proofIndex1Siblings"]
