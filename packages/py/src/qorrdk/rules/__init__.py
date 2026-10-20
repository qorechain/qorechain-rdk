"""Client-side copies of rules the chain enforces, so a transaction the chain
would refuse is caught **before** a fee is paid.

The chain checks both rule sets in the keeper rather than in ``ValidateBasic``
(tightening ``ValidateBasic`` would retroactively refuse what historical blocks
accepted), so it can only tell you after you have paid. These mirror them
exactly; where they disagree, the chain wins and this module is the bug.
"""

from __future__ import annotations

from typing import Optional, Sequence, Union

import bech32

ID_MIN_LENGTH = 3
ID_MAX_LENGTH = 64

#: The only denomination a rollup's escrow ledger can pay a withdrawal in.
ROLLUP_ESCROW_DENOM = "uqor"

#: A batch commits at most 2^64 withdrawals, so a longer path never verifies.
MAX_WITHDRAWAL_PROOF_DEPTH = 64

def rollup_id_error(rollup_id: str) -> Optional[str]:
    """Why ``rollup_id`` breaks the chain's id grammar, or ``None`` if it doesn't.

    From chain v3.2.2 a **new** rollup or layer id must match
    ``^[a-z0-9][a-z0-9._-]{2,63}$`` -- measured in bytes, as the chain does.
    Ids are store-key components joined with ``/``, so an id containing ``/``
    (or sorting as another id's extension) let one layer's anchors, batches or
    blobs be read as another's. Ids created before v3.2.2 stay valid; this is
    for choosing a new one.
    """
    raw = rollup_id.encode("utf-8")
    if len(raw) < ID_MIN_LENGTH or len(raw) > ID_MAX_LENGTH:
        return f"must be {ID_MIN_LENGTH} to {ID_MAX_LENGTH} characters"
    for i, c in enumerate(raw):
        if 0x61 <= c <= 0x7A or 0x30 <= c <= 0x39:  # a-z, 0-9
            continue
        if c in (0x2E, 0x5F, 0x2D) and i > 0:  # . _ -
            continue
        if i == 0:
            return "must start with a lowercase letter or a digit"
        return "may contain only lowercase letters, digits, '.', '_' and '-'"
    return None


def is_valid_rollup_id(rollup_id: str) -> bool:
    """Whether ``rollup_id`` is a valid new rollup/layer id."""
    return rollup_id_error(rollup_id) is None


def _is_bech32(address: str) -> bool:
    """A well-formed bech32 string with a valid checksum (any prefix)."""
    hrp, data = bech32.bech32_decode(address)
    return hrp is not None and data is not None


def _byte_length(sibling: Union[bytes, bytearray, str]) -> int:
    if isinstance(sibling, (bytes, bytearray)):
        return len(sibling)
    h = sibling[2:] if sibling[:2] in ("0x", "0X") else sibling
    try:
        return len(bytes.fromhex(h))
    except ValueError:
        return -1


def withdrawal_errors(
    submitter: str,
    rollup_id: str,
    recipient: str,
    denom: str,
    amount: Union[int, str],
    proof: Optional[Sequence[Union[bytes, bytearray, str]]] = None,
) -> list[str]:
    """Every reason the chain would refuse this withdrawal at the start of
    ``ExecuteWithdrawal`` (chain v3.2.3+, ``rdk-escrow-ledger``), or ``[]``.
    Mirrors ``MsgExecuteWithdrawal.ValidateWithdrawal``.
    """
    errors: list[str] = []
    if not _is_bech32(submitter):
        errors.append(f'invalid submitter address "{submitter}"')
    # Only emptiness: ids from before v3.2.2 may sit outside the grammar.
    if not rollup_id:
        errors.append("rollup_id cannot be empty")
    if not _is_bech32(recipient):
        errors.append(f'invalid recipient address "{recipient}"')
    if denom != ROLLUP_ESCROW_DENOM:
        errors.append(f'denom "{denom}": rollup escrow is held in {ROLLUP_ESCROW_DENOM} only')
    try:
        positive = int(amount) > 0
    except (TypeError, ValueError):
        positive = False
    if not positive:
        errors.append("amount must be a positive integer")
    siblings = list(proof or [])
    if len(siblings) > MAX_WITHDRAWAL_PROOF_DEPTH:
        errors.append(f"proof has {len(siblings)} levels, at most {MAX_WITHDRAWAL_PROOF_DEPTH}")
    for i, sib in enumerate(siblings):
        n = _byte_length(sib)
        if n != 32:
            errors.append(f"proof level {i} is {'not valid hex' if n < 0 else f'{n} bytes'}, want 32")
    return errors


__all__ = [
    "ID_MIN_LENGTH",
    "ID_MAX_LENGTH",
    "ROLLUP_ESCROW_DENOM",
    "MAX_WITHDRAWAL_PROOF_DEPTH",
    "rollup_id_error",
    "is_valid_rollup_id",
    "withdrawal_errors",
]
