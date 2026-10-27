"""The canonical batch transition root: the state root a protocol-following
sequencer publishes for a settlement batch.

The chain judges an optimistic batch by it. A fraud challenge is upheld when the
batch's published ``state_root`` differs from this root and the challenger names
this root (see :func:`fraud_proof`); from chain v3.2.5 any account may resolve
that challenge, and an upheld one is paid from the rollup's escrow. A batch that
publishes anything else, such as a placeholder, is provably fraudulent. The
test vectors come from the chain's own ``BatchTransitionRoot``.
"""

from __future__ import annotations

import struct
from typing import Optional, Union

from ..utils.bytes import to_bytes
from ..utils.qorehash import qorehash

#: The chain v3.2.5 protocol feature for in-order settlement: batches finalize
#: in order, any account may resolve a challenge, an upheld fraud rejects the
#: later batches too, and a rollup with an unsettled batch cannot be stopped.
FEATURE_RDK_CHALLENGE_SETTLEMENT = "rdk-challenge-settlement"

#: The protocol feature that switches batches to the v2 binding.
FEATURE_RDK_WITHDRAWALS_BINDING = "rdk-withdrawals-binding"

BytesLike = Union[str, bytes, bytearray]


def _b(value: Optional[BytesLike]) -> bytes:
    return b"" if value is None else to_bytes(value)


def _field(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


def _shake32(*parts: bytes) -> bytes:
    return qorehash(*parts)


def batch_transition_root_v1(
    prev_state_root: BytesLike, tx_count: int, data_hash: Optional[BytesLike] = None
) -> bytes:
    """The original binding, used for every batch before the chain's
    ``rdk-withdrawals-binding`` switch:
    ``SHAKE-256(prev_state_root || data_hash || tx_count(8B BE))``, 32 bytes."""
    return _shake32(_b(prev_state_root), _b(data_hash), struct.pack(">Q", tx_count))


def batch_transition_root_v2(
    chain_id: str,
    rollup_id: str,
    prev_state_root: BytesLike,
    tx_count: int,
    data_hash: Optional[BytesLike] = None,
    withdrawals_root: Optional[BytesLike] = None,
) -> bytes:
    """The v2 binding (chain v3.2.5, ``rdk-withdrawals-binding``), which also
    covers the chain id, the rollup id and the withdrawals root. Every
    variable-length field carries a 4-byte big-endian length prefix."""
    if not chain_id or not rollup_id:
        raise ValueError("the v2 transition root covers the chain id and the rollup id; pass both")
    wr = _b(withdrawals_root)
    if len(wr) not in (0, 32):
        raise ValueError(f"withdrawals_root must be empty or 32 bytes, got {len(wr)}")
    return _shake32(
        _field(b"qorechain-rdk-transition/v2"),
        _field(chain_id.encode()),
        _field(rollup_id.encode()),
        _field(_b(prev_state_root)),
        _field(_b(data_hash)),
        struct.pack(">Q", tx_count),
        _field(wr),
    )


def batch_transition_root(
    version: str,
    prev_state_root: BytesLike,
    tx_count: int,
    data_hash: Optional[BytesLike] = None,
    chain_id: str = "",
    rollup_id: str = "",
    withdrawals_root: Optional[BytesLike] = None,
) -> bytes:
    """The transition root under ``version`` (``"v1"`` or ``"v2"``)."""
    if version == "v2":
        return batch_transition_root_v2(
            chain_id, rollup_id, prev_state_root, tx_count, data_hash, withdrawals_root
        )
    if version != "v1":
        raise ValueError(f"unknown transition root version {version!r}")
    return batch_transition_root_v1(prev_state_root, tx_count, data_hash)


def transition_root_version_for(rest) -> str:
    """Which binding a batch submitted now is judged by: ``"v2"`` once the
    chain reports ``rdk-withdrawals-binding`` enabled, ``"v1"`` before. A batch
    keeps the binding it was submitted under, so compute the root right before
    submitting."""
    return "v2" if rest.is_protocol_feature_enabled(FEATURE_RDK_WITHDRAWALS_BINDING) else "v1"


def fraud_proof(prev_state_root: BytesLike, correct_state_root: BytesLike) -> bytes:
    """The fraud proof the chain's optimistic verifier reads:
    ``prev_state_root(32) || correct_state_root(32)``."""
    prev, correct = to_bytes(prev_state_root), to_bytes(correct_state_root)
    if len(prev) != 32 or len(correct) != 32:
        raise ValueError("a fraud proof needs a 32-byte previous root and a 32-byte correct root")
    return prev + correct


__all__ = [
    "FEATURE_RDK_CHALLENGE_SETTLEMENT",
    "FEATURE_RDK_WITHDRAWALS_BINDING",
    "batch_transition_root",
    "batch_transition_root_v1",
    "batch_transition_root_v2",
    "transition_root_version_for",
    "fraud_proof",
]
