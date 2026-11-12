"""Posted rollup data and the rollup inbox (chain v3.2.8+).

``MsgPostRollupData`` gives each post the next inbox sequence (from 1) and
extends the rollup's inbox accumulator::

    acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp(chain_id) | lp(rollup_id) | acc_{n-1}
                    | be64(n) | be64(height) | lp(poster) | SHA-256(data))

with ``acc_0`` 32 zero bytes and ``lp`` a 4-byte big-endian length prefix. A
batch of a based rollup sets ``inbox_end`` and carries as ``data_hash`` the
range commitment from the consumed position to ``inbox_end``::

    range = SHA-256("qorechain/rdk/inbox-range/v1" | lp(chain_id) | lp(rollup_id)
                    | be64(from) | be64(to) | acc_from | acc_to)

The chain returns it too (``RestClient.get_inbox(rollup_id, inbox_end)``). A
native-DA batch of a rollup that is not based may carry ``SHA-256(data)`` of a
retained post as its ``data_hash``.
"""

from __future__ import annotations

import hashlib
import struct
from typing import Union

from ..utils.bytes import to_bytes

BytesLike = Union[str, bytes, bytearray]

_ACC_DOMAIN = b"qorechain/rdk/inbox/v1"
_RANGE_DOMAIN = b"qorechain/rdk/inbox-range/v1"

#: The accumulator of an inbox with no post: 32 zero bytes.
EMPTY_INBOX_ACC = bytes(32)


def _lp(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


def _be64(v: int) -> bytes:
    return struct.pack(">Q", int(v))


def _acc(value: BytesLike) -> bytes:
    b = to_bytes(value)
    return EMPTY_INBOX_ACC if len(b) == 0 else b


def posted_data_hash(data: BytesLike) -> bytes:
    """SHA-256 of a post's payload: the hash a batch references. ``data`` is
    bytes or a hex string."""
    return hashlib.sha256(to_bytes(data)).digest()


def inbox_accumulate(
    *,
    chain_id: str,
    rollup_id: str,
    prev_acc: BytesLike,
    sequence: int,
    height: int,
    poster: str,
    data_hash: BytesLike,
) -> bytes:
    """One step of the inbox accumulator (what the chain stores after post
    ``sequence``). ``prev_acc`` is the accumulator before this post (empty or
    :data:`EMPTY_INBOX_ACC` for the first); ``height`` is the height of the
    block that included the post; ``data_hash`` is :func:`posted_data_hash`
    of the payload."""
    h = hashlib.sha256()
    h.update(_ACC_DOMAIN)
    h.update(_lp(chain_id.encode("utf-8")))
    h.update(_lp(rollup_id.encode("utf-8")))
    h.update(_acc(prev_acc))
    h.update(_be64(sequence))
    h.update(_be64(height))
    h.update(_lp(poster.encode("utf-8")))
    h.update(to_bytes(data_hash))
    return h.digest()


def inbox_range_hash(
    *,
    chain_id: str,
    rollup_id: str,
    from_sequence: int,
    to_sequence: int,
    acc_from: BytesLike,
    acc_to: BytesLike,
) -> bytes:
    """The inbox range commitment a based batch carries as ``data_hash``: the
    posts after ``from_sequence`` (the consumed position) up to
    ``to_sequence`` (``inbox_end``)."""
    h = hashlib.sha256()
    h.update(_RANGE_DOMAIN)
    h.update(_lp(chain_id.encode("utf-8")))
    h.update(_lp(rollup_id.encode("utf-8")))
    h.update(_be64(from_sequence))
    h.update(_be64(to_sequence))
    h.update(_acc(acc_from))
    h.update(_acc(acc_to))
    return h.digest()


__all__ = [
    "EMPTY_INBOX_ACC",
    "posted_data_hash",
    "inbox_accumulate",
    "inbox_range_hash",
]
