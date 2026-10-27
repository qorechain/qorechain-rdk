"""Withdrawal-proof assembly for ``MsgExecuteWithdrawal``.

A withdrawal is executed by proving its leaf is committed in a finalized batch's
``withdrawals_root``. This helper turns the batch's withdrawal leaves into the
sibling-hash proof the message carries.

Use :func:`withdrawals_tree`: it builds the chain's own leaves and tree, so its
root and proofs are what ``MsgExecuteWithdrawal`` verifies (tested against the
chain's ``VerifyWithdrawalMerkle``). The chain places each withdrawal at its
index, hashes nodes as SHAKE-256(left || right), and pairs an odd last node with
itself. A batch submitted from chain v3.2.5 (``rdk-withdrawals-binding``)
commits v2 leaves, which also name the chain id; check which with
:func:`~qorrdk.transition.transition_root_version_for`.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Callable, Literal, Mapping, Optional, Sequence, Union

from ..tx.messages import ExecuteWithdrawalInput
from ..utils.qorehash import qorehash
from .merkle import MerkleOptions, binary_merkle_proof, binary_merkle_root

Numeric = Union[int, str]


@dataclass
class WithdrawalLeafInput:
    """One L2 to L1 withdrawal as the chain hashes it."""

    rollup_id: str
    #: The withdrawal's position in its batch; also its leaf position.
    withdrawal_index: Numeric
    recipient: str
    denom: str
    amount: Numeric


def _u64be(value: Numeric) -> bytes:
    return struct.pack(">Q", int(value))


def _lp(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


_ZERO = b"\x00"


def _leaf_input(w: Union[WithdrawalLeafInput, Mapping]) -> WithdrawalLeafInput:
    if isinstance(w, WithdrawalLeafInput):
        return w
    if isinstance(w, Mapping):
        return WithdrawalLeafInput(**w)
    raise TypeError(f"expected WithdrawalLeafInput or dict, got {type(w).__name__}")


def withdrawal_leaf_v1(w: Union[WithdrawalLeafInput, Mapping]) -> bytes:
    """The chain's original withdrawal leaf (every batch before
    ``rdk-withdrawals-binding``): ``SHAKE-256(rollup_id || 0x00 ||
    withdrawal_index(8B BE) || recipient || 0x00 || denom || 0x00 ||
    amount(8B BE))``."""
    w = _leaf_input(w)
    return qorehash(
        w.rollup_id.encode("utf-8"),
        _ZERO,
        _u64be(w.withdrawal_index),
        w.recipient.encode("utf-8"),
        _ZERO,
        w.denom.encode("utf-8"),
        _ZERO,
        _u64be(w.amount),
    )


def withdrawal_leaf_v2(chain_id: str, w: Union[WithdrawalLeafInput, Mapping]) -> bytes:
    """The v2 leaf of a batch bound under chain v3.2.5: the same fields,
    length-prefixed, behind a tag and the chain id, so a withdrawal committed
    for one network has no valid proof on another.

    :raises ValueError: if ``chain_id`` is empty.
    """
    if not chain_id:
        raise ValueError("a v2 withdrawal leaf names the chain id; pass it")
    w = _leaf_input(w)
    return qorehash(
        _lp(b"qorechain-rdk-withdrawal/v2"),
        _lp(chain_id.encode("utf-8")),
        _lp(w.rollup_id.encode("utf-8")),
        _u64be(w.withdrawal_index),
        _lp(w.recipient.encode("utf-8")),
        _lp(w.denom.encode("utf-8")),
        _u64be(w.amount),
    )


def _chain_tree() -> MerkleOptions:
    """The chain's tree over already-hashed leaves."""
    return MerkleOptions(hash_leaves=False, duplicate_odd=True)


@dataclass
class WithdrawalProof:
    """The proof material for a single withdrawal."""

    #: Sibling hashes from the leaf to ``withdrawals_root``, for the ``proof`` field.
    proof: list[bytes]
    #: The computed ``withdrawals_root`` (compare against the batch's).
    withdrawals_root: bytes
    #: The withdrawal's index within the batch.
    withdrawal_index: int


@dataclass
class WithdrawalsTree:
    """A batch's withdrawals, hashed and committed exactly as the chain does."""

    #: The batch's ``withdrawals_root`` (32 bytes).
    root: bytes
    #: The leaves, in withdrawal-index order.
    leaves: list[bytes]

    def proof(self, withdrawal_index: int) -> WithdrawalProof:
        """The proof for the withdrawal at ``withdrawal_index``."""
        return assemble_withdrawal_proof(self.leaves, withdrawal_index)


def withdrawals_tree(
    withdrawals: Sequence[Mapping],
    *,
    rollup_id: str,
    version: Literal["v1", "v2"],
    chain_id: Optional[str] = None,
) -> WithdrawalsTree:
    """Build a batch's withdrawals tree.

    Each item of ``withdrawals`` carries ``recipient``, ``denom`` and
    ``amount``; item ``i`` is withdrawal index ``i``. ``version`` must be the
    binding the chain judges the batch by: ``"v2"`` (with ``chain_id``) for a
    batch submitted from chain v3.2.5's ``rdk-withdrawals-binding``, ``"v1"``
    before.

    :raises ValueError: if ``withdrawals`` is empty, or ``version`` is ``"v2"``
        without a ``chain_id``.
    """
    if len(withdrawals) == 0:
        raise ValueError("a withdrawals tree needs at least one withdrawal")
    if version not in ("v1", "v2"):
        raise ValueError(f'version must be "v1" or "v2", got {version!r}')
    leaf: Callable[[WithdrawalLeafInput], bytes] = (
        (lambda inp: withdrawal_leaf_v2(chain_id or "", inp))
        if version == "v2"
        else withdrawal_leaf_v1
    )
    leaves = [
        leaf(
            WithdrawalLeafInput(
                rollup_id=rollup_id,
                withdrawal_index=i,
                recipient=w["recipient"],
                denom=w["denom"],
                amount=w["amount"],
            )
        )
        for i, w in enumerate(withdrawals)
    ]
    return WithdrawalsTree(root=binary_merkle_root(leaves, _chain_tree()), leaves=leaves)


def assemble_withdrawal_proof(
    leaves: list[bytes],
    withdrawal_index: int,
    options: Optional[MerkleOptions] = None,
) -> WithdrawalProof:
    """Assemble the Merkle proof for the withdrawal at ``withdrawal_index`` from
    the full list of the batch's withdrawal leaves (from
    :func:`withdrawal_leaf_v1` / :func:`withdrawal_leaf_v2`).

    The defaults are the chain's tree (leaves used as given, nodes
    SHAKE-256(left || right), an odd last node paired with itself); before 0.7.0
    they re-hashed each leaf with SHA-256, which the chain does not do.
    """
    result = binary_merkle_proof(
        leaves, withdrawal_index, options if options is not None else _chain_tree()
    )
    return WithdrawalProof(
        proof=result.siblings,
        withdrawals_root=result.root,
        withdrawal_index=withdrawal_index,
    )


def build_execute_withdrawal_input(
    *,
    submitter: str,
    rollup_id: str,
    batch_index: Union[int, str],
    recipient: str,
    denom: str,
    amount: Union[int, str],
    withdrawal: WithdrawalProof,
) -> ExecuteWithdrawalInput:
    """Combine a withdrawal's details with an assembled proof into the tx input."""
    return ExecuteWithdrawalInput(
        submitter=submitter,
        rollup_id=rollup_id,
        batch_index=batch_index,
        withdrawal_index=withdrawal.withdrawal_index,
        recipient=recipient,
        denom=denom,
        amount=amount,
        proof=list(withdrawal.proof),
    )


__all__ = [
    "WithdrawalLeafInput",
    "WithdrawalProof",
    "WithdrawalsTree",
    "withdrawal_leaf_v1",
    "withdrawal_leaf_v2",
    "withdrawals_tree",
    "assemble_withdrawal_proof",
    "build_execute_withdrawal_input",
]
