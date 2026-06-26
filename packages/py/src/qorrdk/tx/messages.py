"""Friendly builders that turn RDK-shaped inputs into encoded protobuf messages.

Each ``*_msg`` function returns an :class:`EncodedMsg` -- the ``Any``-ready type
URL plus the message's protobuf-encoded value bytes. Numeric 64-bit fields accept
``int`` or a numeric string; byte fields accept a hex string (with or without
``0x``) or ``bytes``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from ..utils.bytes import to_bytes
from . import codecs

Numeric = Union[str, int]
BytesLike = Union[str, bytes, bytearray]


def _big(value: Numeric) -> int:
    if isinstance(value, bool):  # pragma: no cover - defensive
        raise ValueError("numeric field must not be a bool")
    return value if isinstance(value, int) else int(str(value))


@dataclass
class EncodedMsg:
    """A protobuf-encoded ``rdk`` message ready to wrap in a Cosmos ``Any``."""

    type_url: str
    value: bytes


@dataclass
class CreateRollupInput:
    creator: str
    rollup_id: str
    profile: str
    vm_type: str
    stake_amount: Numeric


@dataclass
class SubmitBatchInput:
    sequencer: str
    rollup_id: str
    batch_index: Numeric
    state_root: BytesLike
    tx_count: Numeric
    data_hash: BytesLike
    prev_state_root: Optional[BytesLike] = None
    proof: Optional[BytesLike] = None
    withdrawals_root: Optional[BytesLike] = None


@dataclass
class ChallengeBatchInput:
    challenger: str
    rollup_id: str
    batch_index: Numeric
    proof: BytesLike


@dataclass
class ResolveChallengeInput:
    resolver: str
    rollup_id: str
    batch_index: Numeric
    fraud_upheld: bool


@dataclass
class PauseRollupInput:
    creator: str
    rollup_id: str
    reason: Optional[str] = None


@dataclass
class RollupRefInput:
    creator: str
    rollup_id: str


@dataclass
class ExecuteWithdrawalInput:
    submitter: str
    rollup_id: str
    batch_index: Numeric
    withdrawal_index: Numeric
    recipient: str
    denom: str
    amount: Numeric
    proof: Optional[list] = None  # list[BytesLike]


_EMPTY = b""


def create_rollup_msg(inp: CreateRollupInput) -> EncodedMsg:
    msg = codecs.MsgCreateRollup(
        creator=inp.creator,
        rollup_id=inp.rollup_id,
        profile=inp.profile,
        vm_type=inp.vm_type,
        stake_amount=_big(inp.stake_amount),
    )
    return EncodedMsg(msg.type_url, msg.encode())


def submit_batch_msg(inp: SubmitBatchInput) -> EncodedMsg:
    msg = codecs.MsgSubmitBatch(
        sequencer=inp.sequencer,
        rollup_id=inp.rollup_id,
        batch_index=_big(inp.batch_index),
        state_root=to_bytes(inp.state_root),
        prev_state_root=to_bytes(inp.prev_state_root) if inp.prev_state_root else _EMPTY,
        tx_count=_big(inp.tx_count),
        data_hash=to_bytes(inp.data_hash),
        proof=to_bytes(inp.proof) if inp.proof else _EMPTY,
        withdrawals_root=to_bytes(inp.withdrawals_root) if inp.withdrawals_root else _EMPTY,
    )
    return EncodedMsg(msg.type_url, msg.encode())


def challenge_batch_msg(inp: ChallengeBatchInput) -> EncodedMsg:
    msg = codecs.MsgChallengeBatch(
        challenger=inp.challenger,
        rollup_id=inp.rollup_id,
        batch_index=_big(inp.batch_index),
        proof=to_bytes(inp.proof),
    )
    return EncodedMsg(msg.type_url, msg.encode())


def resolve_challenge_msg(inp: ResolveChallengeInput) -> EncodedMsg:
    msg = codecs.MsgResolveChallenge(
        resolver=inp.resolver,
        rollup_id=inp.rollup_id,
        batch_index=_big(inp.batch_index),
        fraud_upheld=inp.fraud_upheld,
    )
    return EncodedMsg(msg.type_url, msg.encode())


def pause_rollup_msg(inp: PauseRollupInput) -> EncodedMsg:
    msg = codecs.MsgPauseRollup(
        creator=inp.creator,
        rollup_id=inp.rollup_id,
        reason=inp.reason or "",
    )
    return EncodedMsg(msg.type_url, msg.encode())


def resume_rollup_msg(inp: RollupRefInput) -> EncodedMsg:
    msg = codecs.MsgResumeRollup(creator=inp.creator, rollup_id=inp.rollup_id)
    return EncodedMsg(msg.type_url, msg.encode())


def stop_rollup_msg(inp: RollupRefInput) -> EncodedMsg:
    msg = codecs.MsgStopRollup(creator=inp.creator, rollup_id=inp.rollup_id)
    return EncodedMsg(msg.type_url, msg.encode())


def execute_withdrawal_msg(inp: ExecuteWithdrawalInput) -> EncodedMsg:
    msg = codecs.MsgExecuteWithdrawal(
        submitter=inp.submitter,
        rollup_id=inp.rollup_id,
        batch_index=_big(inp.batch_index),
        withdrawal_index=_big(inp.withdrawal_index),
        recipient=inp.recipient,
        denom=inp.denom,
        amount=_big(inp.amount),
        proof=[to_bytes(p) for p in (inp.proof or [])],
    )
    return EncodedMsg(msg.type_url, msg.encode())


__all__ = [
    "Numeric",
    "BytesLike",
    "EncodedMsg",
    "CreateRollupInput",
    "SubmitBatchInput",
    "ChallengeBatchInput",
    "ResolveChallengeInput",
    "PauseRollupInput",
    "RollupRefInput",
    "ExecuteWithdrawalInput",
    "create_rollup_msg",
    "submit_batch_msg",
    "challenge_batch_msg",
    "resolve_challenge_msg",
    "pause_rollup_msg",
    "resume_rollup_msg",
    "stop_rollup_msg",
    "execute_withdrawal_msg",
]
