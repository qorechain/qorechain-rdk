"""qledger-v1 fraud proofs: the challenger's side (build) and the chain's
decision (check), so a watcher can decide a batch locally before paying::

    "QLFP" | 0x01 | acc_from[32] | be16(n) | n x (be64(height) | be16(len) poster | be32(len) payload)
    | be16(m) | m x (id[32] | be64(balance) | be64(nonce) | bitmap[32] | popcount(bitmap) x sibling[32])
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Sequence, Union

from ..inbox import EMPTY_INBOX_ACC, inbox_accumulate, inbox_range_hash, posted_data_hash
from ..utils.bytes import to_bytes
from .execute import QledgerEntry, QledgerResult, execute_qledger
from .smt import QledgerLedger, QledgerPartialTree, QledgerState, QledgerWitness
from .tx import be64

BytesLike = Union[str, bytes, bytearray]

#: Most inbox entries one qledger-v1 batch may consume.
QLEDGER_MAX_BATCH_ENTRIES = 64
#: Largest post a qledger-v1 rollup accepts.
QLEDGER_MAX_POST_BYTES = 6 * 1024
_MAX_WITNESSES = 2 * QLEDGER_MAX_BATCH_ENTRIES
_MAX_POSTER_LEN = 256
_MAGIC = b"QLFP"


@dataclass
class QledgerFraudProof:
    """A decoded qledger-v1 fraud proof."""

    acc_from: bytes
    entries: list[QledgerEntry] = field(default_factory=list)
    witnesses: list[QledgerWitness] = field(default_factory=list)


@dataclass
class QledgerClaim:
    """What a qledger-v1 batch published."""

    inbox_start: int
    inbox_end: int
    data_hash: BytesLike
    prev_state_root: BytesLike
    state_root: BytesLike
    withdrawals_root: BytesLike


def encode_qledger_fraud_proof(p: QledgerFraudProof) -> bytes:
    """The proof's wire form."""
    parts = [_MAGIC, b"\x01", bytes(p.acc_from), struct.pack(">H", len(p.entries))]
    for e in p.entries:
        poster = e.poster.encode("utf-8", "surrogateescape")
        payload = bytes(e.payload)
        parts += [be64(e.height), struct.pack(">H", len(poster)), poster,
                  struct.pack(">I", len(payload)), payload]
    parts.append(struct.pack(">H", len(p.witnesses)))
    for w in p.witnesses:
        parts += [bytes(w.id), be64(w.balance), be64(w.nonce), bytes(w.bitmap)]
        parts += [bytes(s) for s in w.siblings]
    return b"".join(parts)


class _Reader:
    def __init__(self, b: bytes) -> None:
        self.b = b
        self.p = 0

    def take(self, n: int) -> bytes:
        if n < 0 or len(self.b) - self.p < n:
            raise ValueError("qledger: malformed fraud proof")
        out = self.b[self.p : self.p + n]
        self.p += n
        return out

    def u16(self) -> int:
        return struct.unpack(">H", self.take(2))[0]

    def u32(self) -> int:
        return struct.unpack(">I", self.take(4))[0]

    def u64(self) -> int:
        return struct.unpack(">Q", self.take(8))[0]


def decode_qledger_fraud_proof(data: BytesLike) -> QledgerFraudProof:
    """Parse a proof, refusing anything over the chain's bounds or with
    trailing bytes."""
    bad = ValueError("qledger: malformed fraud proof")
    r = _Reader(to_bytes(data))
    head = r.take(5)
    if head[:4] != _MAGIC or head[4] != 1:
        raise bad
    acc_from = r.take(32)
    n = r.u16()
    if n > QLEDGER_MAX_BATCH_ENTRIES:
        raise bad
    entries: list[QledgerEntry] = []
    for _ in range(n):
        height = r.u64()
        pl = r.u16()
        if pl > _MAX_POSTER_LEN:
            raise bad
        poster = r.take(pl).decode("utf-8", "surrogateescape")
        ln = r.u32()
        if ln > QLEDGER_MAX_POST_BYTES:
            raise bad
        entries.append(QledgerEntry(height=height, poster=poster, payload=r.take(ln)))
    m = r.u16()
    if m > _MAX_WITNESSES:
        raise bad
    witnesses: list[QledgerWitness] = []
    for _ in range(m):
        wid = r.take(32)
        balance = r.u64()
        nonce = r.u64()
        bitmap = r.take(32)
        cnt = sum(bin(x).count("1") for x in bitmap)
        siblings = [r.take(32) for _ in range(cnt)]
        witnesses.append(QledgerWitness(id=wid, balance=balance, nonce=nonce, bitmap=bitmap, siblings=siblings))
    if r.p != len(r.b):
        raise bad
    return QledgerFraudProof(acc_from=acc_from, entries=entries, witnesses=witnesses)


class _Recorder:
    """Records every account an execution touches, in first-touch order."""

    def __init__(self, inner: QledgerState) -> None:
        self.inner = inner
        self.order: list[bytes] = []
        self._seen: set[bytes] = set()

    def _note(self, account_id: bytes) -> None:
        k = bytes(account_id)
        if k not in self._seen:
            self._seen.add(k)
            self.order.append(k)

    def get(self, account_id: bytes) -> tuple[int, int]:
        self._note(account_id)
        return self.inner.get(account_id)

    def set(self, account_id: bytes, balance: int, nonce: int) -> None:
        self._note(account_id)
        self.inner.set(account_id, balance, nonce)

    def root(self) -> bytes:
        return self.inner.root()


def build_qledger_fraud_proof(
    parent: QledgerLedger,
    acc_from: BytesLike,
    entries: Sequence[QledgerEntry],
    *,
    chain_id: str,
    rollup_id: str,
) -> tuple[bytes, QledgerResult]:
    """The challenger's side: from the batch's parent state, the inbox
    accumulator at the batch's start and the entries it consumed, the encoded
    proof to send with ``challenge_batch``, and the result an honest batch
    would have published."""
    rec = _Recorder(parent.clone())
    honest = execute_qledger(rec, entries, chain_id=chain_id, rollup_id=rollup_id)
    acc = to_bytes(acc_from)
    proof = encode_qledger_fraud_proof(
        QledgerFraudProof(
            acc_from=EMPTY_INBOX_ACC if len(acc) == 0 else acc,
            entries=list(entries),
            witnesses=[parent.witness(i) for i in rec.order],
        )
    )
    return proof, honest


def _not_applicable(why: str) -> ValueError:
    return ValueError(f"qledger: the fraud proof does not apply: {why}")


def check_qledger_fraud(
    claim: QledgerClaim, proof: BytesLike, *, chain_id: str, rollup_id: str
) -> bool:
    """Decide a fraud proof as the chain does: ``True`` when re-executing the
    batch's inputs from its parent state gives a different state or
    withdrawals root than it published, ``False`` when the batch is right.
    Raises ``ValueError`` when the proof cannot decide (malformed, not about
    this batch, incomplete witness): the chain refuses such a challenge."""
    p = decode_qledger_fraud_proof(proof)
    start, end = int(claim.inbox_start), int(claim.inbox_end)
    if end < start or len(p.entries) != end - start:
        raise _not_applicable(f"{len(p.entries)} entries for inbox range {start}..{end}")
    acc = p.acc_from
    for i, e in enumerate(p.entries):
        acc = inbox_accumulate(
            chain_id=chain_id,
            rollup_id=rollup_id,
            prev_acc=acc,
            sequence=start + i + 1,
            height=e.height,
            poster=e.poster,
            data_hash=posted_data_hash(e.payload),
        )
    want = inbox_range_hash(
        chain_id=chain_id, rollup_id=rollup_id, from_sequence=start, to_sequence=end,
        acc_from=p.acc_from, acc_to=acc,
    )
    if want != to_bytes(claim.data_hash):
        raise _not_applicable("the entries do not hash to the batch's inbox range")
    prev = to_bytes(claim.prev_state_root)
    if len(prev) != 32:
        raise _not_applicable("the batch has no 32-byte parent root")
    res = execute_qledger(
        QledgerPartialTree(prev, p.witnesses), p.entries, chain_id=chain_id, rollup_id=rollup_id
    )
    return res.state_root != to_bytes(claim.state_root) or res.withdrawals_root != to_bytes(
        claim.withdrawals_root
    )


__all__ = [
    "QLEDGER_MAX_BATCH_ENTRIES",
    "QLEDGER_MAX_POST_BYTES",
    "QledgerFraudProof",
    "QledgerClaim",
    "encode_qledger_fraud_proof",
    "decode_qledger_fraud_proof",
    "build_qledger_fraud_proof",
    "check_qledger_fraud",
]
