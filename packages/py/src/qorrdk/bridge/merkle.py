"""Generic binary Merkle tree utilities for assembling withdrawal proofs.

An ``rdk`` settlement batch commits its L2->L1 messages (withdrawals) as a binary
Merkle root (``withdrawals_root``), and ``MsgExecuteWithdrawal`` carries the
sibling hashes from a leaf to that root. These helpers build the root and a
leaf's proof.

The hash defaults to the chain's: SHAKE-256 with a 32-byte output. For a batch's
withdrawals use :func:`~qorrdk.bridge.withdrawal.withdrawals_tree`, which also
builds the chain's leaves and places each at its withdrawal index; these generic
helpers hash each input leaf by default, which the chain does not. Releases
before 0.7.0 defaulted to SHA-256, which no chain construction uses.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from ..utils.qorehash import qorehash


def _qorehash(data: bytes) -> bytes:
    return qorehash(data)


@dataclass
class MerkleOptions:
    """Tunable Merkle-tree construction parameters."""

    #: Hash for internal nodes (and leaves when ``hash_leaves``). Default
    #: SHAKE-256 (32 bytes).
    hash: Callable[[bytes], bytes] = _qorehash
    #: Hash each input leaf before building the tree. Default True.
    hash_leaves: bool = True
    #: On an odd number of nodes, duplicate the last one. Default True.
    duplicate_odd: bool = True


def _resolved(options: Optional[MerkleOptions]) -> MerkleOptions:
    return options if options is not None else MerkleOptions()


def _leaf_nodes(leaves: list[bytes], opts: MerkleOptions) -> list[bytes]:
    if opts.hash_leaves:
        return [opts.hash(leaf) for leaf in leaves]
    return list(leaves)


def binary_merkle_root(
    leaves: list[bytes], options: Optional[MerkleOptions] = None
) -> bytes:
    """Compute the binary Merkle root of a list of leaves."""
    opts = _resolved(options)
    if len(leaves) == 0:
        return opts.hash(b"")
    level = _leaf_nodes(leaves, opts)
    while len(level) > 1:
        nxt: list[bytes] = []
        for i in range(0, len(level), 2):
            left = level[i]
            if i + 1 < len(level):
                right = level[i + 1]
            elif opts.duplicate_odd:
                right = level[i]
            else:
                right = None
            nxt.append(opts.hash(left + right) if right is not None else left)
        level = nxt
    return level[0]


@dataclass
class MerkleProof:
    """A leaf's Merkle proof: the sibling hashes from the leaf up to the root."""

    #: Sibling hashes, leaf level first.
    siblings: list[bytes]
    #: The computed root.
    root: bytes
    #: The leaf index the proof is for.
    index: int


def binary_merkle_proof(
    leaves: list[bytes], index: int, options: Optional[MerkleOptions] = None
) -> MerkleProof:
    """Build the Merkle proof (sibling path) for the leaf at ``index``."""
    if index < 0 or index >= len(leaves):
        raise ValueError(
            f"leaf index {index} out of range (0..{len(leaves) - 1})"
        )
    opts = _resolved(options)
    siblings: list[bytes] = []
    level = _leaf_nodes(leaves, opts)
    idx = index
    while len(level) > 1:
        is_right = idx % 2 == 1
        sibling_idx = idx - 1 if is_right else idx + 1
        if sibling_idx < len(level):
            siblings.append(level[sibling_idx])
        elif opts.duplicate_odd:
            siblings.append(level[idx])
        nxt: list[bytes] = []
        for i in range(0, len(level), 2):
            left = level[i]
            if i + 1 < len(level):
                right = level[i + 1]
            elif opts.duplicate_odd:
                right = level[i]
            else:
                right = None
            nxt.append(opts.hash(left + right) if right is not None else left)
        level = nxt
        idx //= 2
    return MerkleProof(siblings=siblings, root=level[0], index=index)


def verify_binary_merkle_proof(
    leaf: bytes,
    index: int,
    siblings: list[bytes],
    root: bytes,
    options: Optional[MerkleOptions] = None,
) -> bool:
    """Verify a leaf against a Merkle root using a sibling path."""
    opts = _resolved(options)
    node = opts.hash(leaf) if opts.hash_leaves else leaf
    idx = index
    for sibling in siblings:
        is_right = idx % 2 == 1
        node = opts.hash(sibling + node) if is_right else opts.hash(node + sibling)
        idx //= 2
    return node == root


__all__ = [
    "MerkleOptions",
    "MerkleProof",
    "binary_merkle_root",
    "binary_merkle_proof",
    "verify_binary_merkle_proof",
]
