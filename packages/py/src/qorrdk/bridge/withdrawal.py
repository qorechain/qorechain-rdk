"""Withdrawal-proof assembly for ``MsgExecuteWithdrawal``.

A withdrawal is executed by proving its leaf is committed in a finalized batch's
``withdrawals_root``. This helper turns the batch's withdrawal leaves into the
sibling-hash proof the message carries. The leaf encoding and hashing must match
the network's construction -- see :class:`MerkleOptions`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

from ..tx.messages import ExecuteWithdrawalInput
from .merkle import MerkleOptions, binary_merkle_proof


@dataclass
class WithdrawalProof:
    """The proof material for a single withdrawal."""

    #: Sibling hashes from the leaf to ``withdrawals_root``, for the ``proof`` field.
    proof: list[bytes]
    #: The computed ``withdrawals_root`` (compare against the batch's).
    withdrawals_root: bytes
    #: The withdrawal's index within the batch.
    withdrawal_index: int


def assemble_withdrawal_proof(
    leaves: list[bytes],
    withdrawal_index: int,
    options: Optional[MerkleOptions] = None,
) -> WithdrawalProof:
    """Assemble the Merkle proof for the withdrawal at ``withdrawal_index``."""
    result = binary_merkle_proof(leaves, withdrawal_index, options)
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
    "WithdrawalProof",
    "assemble_withdrawal_proof",
    "build_execute_withdrawal_input",
]
