"""qledger-v1 execution: what a batch's state root and withdrawals root must be
for the inbox entries it consumes. The chain re-runs exactly this in a fraud
proof, so a submitter that publishes anything else loses its bond.

Entries that do not parse, carry a bad signature, the wrong nonce, a zero
amount, more than the balance, or a non-canonical recipient are no-ops: an open
inbox must accept anything without making a batch invalid.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass, field
from typing import Optional, Sequence, Union

import bech32 as _bech32

from ..utils.qorehash import qorehash
from .smt import QledgerState
from .tx import (
    QLEDGER_DEPOSIT_POSTER_PREFIX,
    QLEDGER_KIND_TRANSFER,
    QLEDGER_KIND_WITHDRAW,
    be64,
    decode_qledger_deposit,
    decode_qledger_tx,
    qledger_account_id,
    verify_qledger_tx,
)

BytesLike = Union[str, bytes, bytearray]

_MAX_U64 = (1 << 64) - 1
_MAX_I64 = (1 << 63) - 1

#: The denom every qledger-v1 withdrawal pays.
QLEDGER_WITHDRAWAL_DENOM = "uqor"

#: The reserved state slot holding the rollup's next withdrawal index (in its
#: balance). Withdrawal indices are global to the rollup.
QLEDGER_WITHDRAWAL_COUNTER_ID: bytes = hashlib.sha256(b"qledger/v1/withdrawal-counter").digest()


@dataclass
class QledgerEntry:
    """One inbox entry a batch consumes."""

    #: The height of the block that included the post.
    height: int
    #: The poster address, or ``"deposit:" + depositor`` for a deposit.
    poster: str
    payload: bytes


@dataclass
class QledgerWithdrawal:
    """One withdrawal a batch commits, at its global index."""

    index: int
    recipient: str
    amount: int


@dataclass
class QledgerResult:
    """What a batch must publish."""

    state_root: bytes
    withdrawals: list[QledgerWithdrawal] = field(default_factory=list)
    #: Empty when the batch has no withdrawal.
    withdrawals_root: bytes = b""


def is_canonical_qor_address(s: str) -> bool:
    """Whether ``s`` is a ``qor1`` account address in canonical (lowercase,
    re-encoding) form."""
    if not isinstance(s, str):
        return False
    try:
        hrp, words = _bech32.bech32_decode(s)
        if hrp != "qor" or words is None:
            return False
        data = _bech32.convertbits(words, 5, 8, False)
        if data is None or len(data) == 0 or len(data) > 255:
            return False
        return _bech32.bech32_encode("qor", words) == s
    except Exception:  # noqa: BLE001
        return False


def execute_qledger(
    state: QledgerState,
    entries: Sequence[QledgerEntry],
    *,
    chain_id: str,
    rollup_id: str,
) -> QledgerResult:
    """Apply ``entries`` to ``state`` in order and return the roots the batch
    must publish. Raises only when ``state`` cannot serve an account (a partial
    tree missing a witness)."""
    counter = QLEDGER_WITHDRAWAL_COUNTER_ID
    withdrawals: list[QledgerWithdrawal] = []
    for e in entries:
        if e.poster.startswith(QLEDGER_DEPOSIT_POSTER_PREFIX):
            dep = decode_qledger_deposit(e.payload)
            if dep is None or dep.account == counter:
                continue
            balance, nonce = state.get(dep.account)
            if balance > _MAX_U64 - dep.amount:
                continue
            state.set(dep.account, balance + dep.amount, nonce)
            continue
        tx = decode_qledger_tx(e.payload)
        if tx is None or not verify_qledger_tx(tx, chain_id, rollup_id):
            continue
        sender = qledger_account_id(tx.public_key, tx.scheme)
        balance, nonce = state.get(sender)
        if tx.nonce != nonce or tx.amount == 0 or balance < tx.amount or nonce == _MAX_U64:
            continue
        if tx.kind == QLEDGER_KIND_TRANSFER:
            to = bytes(tx.to or b"")
            if to == counter:
                continue
            if to == sender:
                state.set(sender, balance, nonce + 1)
                continue
            to_balance, to_nonce = state.get(to)
            if to_balance > _MAX_U64 - tx.amount:
                continue
            state.set(sender, balance - tx.amount, nonce + 1)
            state.set(to, to_balance + tx.amount, to_nonce)
        elif tx.kind == QLEDGER_KIND_WITHDRAW:
            if tx.amount > _MAX_I64 or not is_canonical_qor_address(tx.recipient or ""):
                continue
            nxt, _ = state.get(counter)
            if nxt == _MAX_U64:
                continue
            state.set(sender, balance - tx.amount, nonce + 1)
            state.set(counter, nxt + 1, 0)
            withdrawals.append(QledgerWithdrawal(index=nxt, recipient=tx.recipient or "", amount=tx.amount))
    return QledgerResult(
        state_root=state.root(),
        withdrawals=withdrawals,
        withdrawals_root=qledger_withdrawals_root(chain_id, rollup_id, withdrawals),
    )


def _lp(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


def qledger_withdrawal_leaf(
    chain_id: str, rollup_id: str, index: int, recipient: str, amount: int
) -> bytes:
    """The chain's v2 withdrawal leaf (SHAKE-256, every field length-prefixed)."""
    return qorehash(
        _lp(b"qorechain-rdk-withdrawal/v2"),
        _lp(chain_id.encode("utf-8")),
        _lp(rollup_id.encode("utf-8")),
        be64(index),
        _lp(recipient.encode("utf-8", "surrogateescape")),
        _lp(QLEDGER_WITHDRAWAL_DENOM.encode("utf-8")),
        be64(amount),
    )


def _levels(
    chain_id: str, rollup_id: str, ws: Sequence[QledgerWithdrawal]
) -> Optional[list[list[bytes]]]:
    if not ws:
        return None
    n = 1
    while n < len(ws):
        n *= 2
    # Consecutive global indices: positions index mod n are distinct.
    level = [bytes(32)] * n
    for w in ws:
        level[int(w.index) % n] = qledger_withdrawal_leaf(
            chain_id, rollup_id, w.index, w.recipient, w.amount
        )
    out = [level]
    while len(level) > 1:
        level = [qorehash(level[2 * i], level[2 * i + 1]) for i in range(len(level) // 2)]
        out.append(level)
    return out


def qledger_withdrawals_root(
    chain_id: str, rollup_id: str, withdrawals: Sequence[QledgerWithdrawal]
) -> bytes:
    """A qledger-v1 batch's withdrawals root: its withdrawals in a tree of the
    next power of two, each at its global index modulo that size, the rest
    zero; empty when there is none."""
    levels = _levels(chain_id, rollup_id, withdrawals)
    return levels[-1][0] if levels else b""


def qledger_withdrawal_proof(
    chain_id: str, rollup_id: str, withdrawals: Sequence[QledgerWithdrawal], i: int
) -> list[bytes]:
    """The sibling path of withdrawal ``i`` of a batch, as
    ``MsgExecuteWithdrawal`` takes it."""
    levels = _levels(chain_id, rollup_id, withdrawals)
    if levels is None or i < 0 or i >= len(withdrawals):
        raise ValueError("qledger: no such withdrawal")
    idx = int(withdrawals[i].index) % len(levels[0])
    path: list[bytes] = []
    for level in levels[:-1]:
        path.append(level[idx ^ 1])
        idx >>= 1
    return path


__all__ = [
    "QLEDGER_WITHDRAWAL_DENOM",
    "QLEDGER_WITHDRAWAL_COUNTER_ID",
    "QledgerEntry",
    "QledgerWithdrawal",
    "QledgerResult",
    "is_canonical_qor_address",
    "execute_qledger",
    "qledger_withdrawal_leaf",
    "qledger_withdrawals_root",
    "qledger_withdrawal_proof",
]
