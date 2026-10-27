"""Bridge: binary-Merkle utilities and withdrawal-proof assembly."""

from __future__ import annotations

from .merkle import (
    MerkleOptions,
    MerkleProof,
    binary_merkle_proof,
    binary_merkle_root,
    verify_binary_merkle_proof,
)
from .withdrawal import (
    WithdrawalLeafInput,
    WithdrawalProof,
    WithdrawalsTree,
    assemble_withdrawal_proof,
    build_execute_withdrawal_input,
    withdrawal_leaf_v1,
    withdrawal_leaf_v2,
    withdrawals_tree,
)

__all__ = [
    "MerkleOptions",
    "MerkleProof",
    "binary_merkle_root",
    "binary_merkle_proof",
    "verify_binary_merkle_proof",
    "WithdrawalLeafInput",
    "WithdrawalProof",
    "WithdrawalsTree",
    "withdrawal_leaf_v1",
    "withdrawal_leaf_v2",
    "withdrawals_tree",
    "assemble_withdrawal_proof",
    "build_execute_withdrawal_input",
]
