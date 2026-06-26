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
    WithdrawalProof,
    assemble_withdrawal_proof,
    build_execute_withdrawal_input,
)

__all__ = [
    "MerkleOptions",
    "MerkleProof",
    "binary_merkle_root",
    "binary_merkle_proof",
    "verify_binary_merkle_proof",
    "WithdrawalProof",
    "assemble_withdrawal_proof",
    "build_execute_withdrawal_input",
]
