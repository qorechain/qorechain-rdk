"""The qledger-v1 state tree: a sparse Merkle tree of depth 256 over account
ids (SHA-256), one level per bit, most significant bit first::

    empty leaf = SHA-256(0x00 | "qledger/v1/empty")
    leaf       = SHA-256(0x00 | id[32] | be64(balance) | be64(nonce))   (empty leaf when both are 0)
    node       = SHA-256(0x01 | left | right)
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Optional, Protocol, Sequence, Union

from ..utils.bytes import to_bytes
from .tx import be64

BytesLike = Union[str, bytes, bytearray]

#: Depth of the state tree (one level per bit of an account id).
QLEDGER_DEPTH = 256


def _hash_node(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def _empty_hashes() -> list[bytes]:
    e = [hashlib.sha256(b"\x00" + b"qledger/v1/empty").digest()]
    for _ in range(QLEDGER_DEPTH):
        e.append(_hash_node(e[-1], e[-1]))
    return e


_EMPTY = _empty_hashes()


def qledger_empty_hash(h: int) -> bytes:
    """The root of an empty subtree of height ``h`` (0 = the empty leaf)."""
    return _EMPTY[h]


def qledger_empty_root() -> bytes:
    """The state root of a ledger with no account: the parent root of a
    rollup's first batch."""
    return _EMPTY[QLEDGER_DEPTH]


def qledger_leaf_hash(account_id: bytes, balance: int, nonce: int) -> bytes:
    """The leaf of an account (the empty leaf for a zero account)."""
    if balance == 0 and nonce == 0:
        return _EMPTY[0]
    return hashlib.sha256(b"\x00" + bytes(account_id) + be64(balance) + be64(nonce)).digest()


def _bit(account_id: bytes, i: int) -> int:
    return (account_id[i >> 3] >> (7 - (i & 7))) & 1


def _id32(account_id: BytesLike) -> bytes:
    b = to_bytes(account_id)
    if len(b) != 32:
        raise ValueError("qledger: an account id is 32 bytes")
    return b


@dataclass
class QledgerWitness:
    """Opens one account against a state root. Siblings run leaf to root, only
    the non-empty ones, flagged in ``bitmap`` (bit d-1 for depth d, MSB first)."""

    id: bytes
    balance: int
    nonce: int
    bitmap: bytes
    siblings: list[bytes] = field(default_factory=list)


class QledgerState(Protocol):
    """What execution reads and writes."""

    def get(self, account_id: bytes) -> tuple[int, int]:
        """``(balance, nonce)`` of an account."""
        ...

    def set(self, account_id: bytes, balance: int, nonce: int) -> None:
        ...

    def root(self) -> bytes:
        ...


class QledgerIncompleteWitnessError(ValueError):
    """Raised when execution touches an account a partial tree does not hold."""

    def __init__(self) -> None:
        super().__init__("qledger: the witness does not open an account the batch touches")


class QledgerLedger:
    """A whole qledger-v1 state in memory: what a submitter or a challenger
    keeps, and what builds witnesses. Zero accounts are not stored, so the root
    is unique for a state."""

    def __init__(self) -> None:
        self._accts: dict[bytes, tuple[int, int]] = {}

    def get(self, account_id: BytesLike) -> tuple[int, int]:
        return self._accts.get(_id32(account_id), (0, 0))

    def set(self, account_id: BytesLike, balance: int, nonce: int) -> None:
        k = _id32(account_id)
        if balance == 0 and nonce == 0:
            self._accts.pop(k, None)
        else:
            self._accts[k] = (int(balance), int(nonce))

    def clone(self) -> "QledgerLedger":
        c = QledgerLedger()
        c._accts = dict(self._accts)
        return c

    def accounts(self) -> list[tuple[bytes, int, int]]:
        """Every non-zero account as ``(id, balance, nonce)``, sorted by id."""
        return [(k, b, n) for k, (b, n) in sorted(self._accts.items())]

    def _subtree(self, d: int, ids: Sequence[bytes]) -> bytes:
        if not ids:
            return _EMPTY[QLEDGER_DEPTH - d]
        if len(ids) == 1:
            account_id = ids[0]
            balance, nonce = self.get(account_id)
            cur = qledger_leaf_hash(account_id, balance, nonce)
            for dd in range(QLEDGER_DEPTH, d, -1):
                empty = _EMPTY[QLEDGER_DEPTH - dd]
                cur = _hash_node(cur, empty) if _bit(account_id, dd - 1) == 0 else _hash_node(empty, cur)
            return cur
        left = [x for x in ids if _bit(x, d) == 0]
        right = [x for x in ids if _bit(x, d) == 1]
        return _hash_node(self._subtree(d + 1, left), self._subtree(d + 1, right))

    def root(self) -> bytes:
        return self._subtree(0, sorted(self._accts))

    def witness(self, account_id: BytesLike) -> QledgerWitness:
        """A witness for ``account_id`` (present or not) against :meth:`root`."""
        aid = _id32(account_id)
        balance, nonce = self.get(aid)
        bitmap = bytearray(32)
        top_down: list[tuple[int, bytes]] = []
        ids = sorted(self._accts)
        # Walk down from the root: at each depth d (1..256) the sibling of the
        # account's node is the subtree on the other side of bit d-1.
        for d in range(1, QLEDGER_DEPTH + 1):
            mine = _bit(aid, d - 1)
            same = [x for x in ids if _bit(x, d - 1) == mine]
            other = [x for x in ids if _bit(x, d - 1) != mine]
            if other:
                top_down.append((d, self._subtree(d, other)))
            ids = same
        siblings: list[bytes] = []
        for d, h in reversed(top_down):
            bitmap[(d - 1) >> 3] |= 1 << (7 - ((d - 1) & 7))
            siblings.append(h)
        return QledgerWitness(id=aid, balance=balance, nonce=nonce, bitmap=bytes(bitmap), siblings=siblings)


def _key_of(account_id: bytes, d: int) -> tuple[int, bytes]:
    p = bytearray(32)
    p[: d >> 3] = account_id[: d >> 3]
    if d & 7:
        p[d >> 3] = account_id[d >> 3] & ((0xFF << (8 - (d & 7))) & 0xFF)
    return (d, bytes(p))


def _sib_key(account_id: bytes, d: int) -> tuple[int, bytes]:
    f = bytearray(account_id)
    f[(d - 1) >> 3] ^= 1 << (7 - ((d - 1) & 7))
    return _key_of(bytes(f), d)


_BAD_WITNESS = "qledger: witness does not match the state root"


class QledgerPartialTree:
    """The part of a state tree a set of witnesses opens, checked against a
    root (what the chain builds from a fraud proof). Reading an account outside
    it raises :class:`QledgerIncompleteWitnessError`."""

    def __init__(self, root: BytesLike, witnesses: Sequence[QledgerWitness]) -> None:
        root_b = to_bytes(root)
        self._nodes: dict[tuple[int, bytes], bytes] = {}
        self._accts: dict[bytes, tuple[int, int]] = {}
        self._current = root_b

        def put(k: tuple[int, bytes], v: bytes) -> None:
            old = self._nodes.get(k)
            if old is not None and old != v:
                raise ValueError(_BAD_WITNESS)
            self._nodes[k] = v

        for w in witnesses:
            wid = bytes(w.id)
            if len(wid) != 32 or len(w.bitmap) != 32:
                raise ValueError(_BAD_WITNESS)
            cur = qledger_leaf_hash(wid, w.balance, w.nonce)
            put(_key_of(wid, QLEDGER_DEPTH), cur)
            si = 0
            for d in range(QLEDGER_DEPTH, 0, -1):
                sib = _EMPTY[QLEDGER_DEPTH - d]
                if (w.bitmap[(d - 1) >> 3] >> (7 - ((d - 1) & 7))) & 1:
                    if si >= len(w.siblings):
                        raise ValueError(_BAD_WITNESS)
                    sib = bytes(w.siblings[si])
                    si += 1
                put(_sib_key(wid, d), sib)
                cur = _hash_node(cur, sib) if _bit(wid, d - 1) == 0 else _hash_node(sib, cur)
                put(_key_of(wid, d - 1), cur)
            if si != len(w.siblings) or cur != root_b:
                raise ValueError(_BAD_WITNESS)
            self._accts[wid] = (w.balance, w.nonce)

    def get(self, account_id: BytesLike) -> tuple[int, int]:
        a = self._accts.get(bytes(to_bytes(account_id)))
        if a is None:
            raise QledgerIncompleteWitnessError()
        return a

    def set(self, account_id: BytesLike, balance: int, nonce: int) -> None:
        aid = bytes(to_bytes(account_id))
        if aid not in self._accts:
            raise QledgerIncompleteWitnessError()
        self._accts[aid] = (int(balance), int(nonce))
        cur = qledger_leaf_hash(aid, balance, nonce)
        self._nodes[_key_of(aid, QLEDGER_DEPTH)] = cur
        for d in range(QLEDGER_DEPTH, 0, -1):
            sib: Optional[bytes] = self._nodes.get(_sib_key(aid, d))
            if sib is None:
                raise QledgerIncompleteWitnessError()
            cur = _hash_node(cur, sib) if _bit(aid, d - 1) == 0 else _hash_node(sib, cur)
            self._nodes[_key_of(aid, d - 1)] = cur
        self._current = cur

    def root(self) -> bytes:
        return self._current


__all__ = [
    "QLEDGER_DEPTH",
    "QledgerWitness",
    "QledgerState",
    "QledgerIncompleteWitnessError",
    "QledgerLedger",
    "QledgerPartialTree",
    "qledger_empty_hash",
    "qledger_empty_root",
    "qledger_leaf_hash",
]
