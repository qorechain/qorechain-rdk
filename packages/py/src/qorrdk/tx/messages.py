"""Friendly builders that turn RDK-shaped inputs into encoded protobuf messages.

Each ``*_msg`` function returns an :class:`EncodedMsg` -- the ``Any``-ready type
URL plus the message's protobuf-encoded value bytes. Numeric 64-bit fields accept
``int`` or a numeric string; byte fields accept a hex string (with or without
``0x``) or ``bytes``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence, Union

from ..enums import vm_type_wire_value
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
    #: Chain v3.2.7+: register the zk verification key at creation (see
    #: :func:`set_verification_key_msg`).
    verification_key: Optional[BytesLike] = None
    #: Chain v3.2.8+: ``"based"`` orders the rollup's transactions by their
    #: inclusion on the chain (anyone posts, every batch consumes the inbox).
    #: Allowed for zk (snark), based settlement, and qledger-v1 optimistic rollups.
    sequencing: str = ""
    #: Chain v3.2.8+: ``"qledger-v1"``, the execution model the chain
    #: re-executes in a fraud proof. **Required for every new optimistic
    #: rollup** (``nft``, ``custom``), together with ``sequencing="based"``.
    execution_vm: str = ""
    #: Chain v3.2.8+: ``"encapsulated"`` for a private rollup (zk with a Groth16
    #: key only).
    privacy: str = ""


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
    #: Chain v3.2.8+, based rollups only: the inbox sequence of the last post
    #: this batch consumes. ``data_hash`` must then be the inbox range
    #: commitment (:func:`~qorrdk.inbox.inbox_range_hash`, or
    #: ``RestClient.get_inbox(rollup_id, inbox_end)``).
    inbox_end: Optional[Numeric] = None


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
        vm_type=vm_type_wire_value(inp.vm_type),
        stake_amount=_big(inp.stake_amount),
        verification_key=to_bytes(inp.verification_key) if inp.verification_key else _EMPTY,
        sequencing=str(getattr(inp.sequencing, "value", inp.sequencing) or ""),
        execution_vm=str(getattr(inp.execution_vm, "value", inp.execution_vm) or ""),
        privacy=str(getattr(inp.privacy, "value", inp.privacy) or ""),
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
        inbox_end=0 if inp.inbox_end is None else _big(inp.inbox_end),
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


# --- chain v3.2.7+ ---------------------------------------------------------


@dataclass
class SetVerificationKeyInput:
    creator: str
    rollup_id: str
    #: Groth16 BLS12-381 verifying key, gnark binary encoding, four public inputs.
    verification_key: BytesLike
    #: ``"snark"``; empty keeps the rollup's proof system. ``"stark"`` is
    #: refused from v3.2.8.
    proof_system: str = ""


def set_verification_key_msg(inp: SetVerificationKeyInput) -> EncodedMsg:
    msg = codecs.MsgSetVerificationKey(
        creator=inp.creator,
        rollup_id=inp.rollup_id,
        verification_key=to_bytes(inp.verification_key),
        proof_system=str(getattr(inp.proof_system, "value", inp.proof_system) or ""),
    )
    return EncodedMsg(msg.type_url, msg.encode())


def update_verification_key_msg(
    *, authority: str, rollup_id: str, verification_key: BytesLike, proof_system: str = ""
) -> EncodedMsg:
    """Governance only: put this message in a proposal; ``authority`` is the
    gov module account."""
    msg = codecs.MsgUpdateVerificationKey(
        authority=authority,
        rollup_id=rollup_id,
        verification_key=to_bytes(verification_key),
        proof_system=str(getattr(proof_system, "value", proof_system) or ""),
    )
    return EncodedMsg(msg.type_url, msg.encode())


# --- chain v3.2.8+ ---------------------------------------------------------


def post_rollup_data_msg(*, poster: str, rollup_id: str, data: BytesLike) -> EncodedMsg:
    """Post rollup data on chain. ``data`` is bytes or a hex string."""
    msg = codecs.MsgPostRollupData(poster=poster, rollup_id=rollup_id, data=to_bytes(data))
    return EncodedMsg(msg.type_url, msg.encode())


def set_rollup_sequencing_msg(*, authority: str, rollup_id: str, sequencing: str) -> EncodedMsg:
    """Governance only: ``sequencing`` is ``"based"`` or ``""``."""
    msg = codecs.MsgSetRollupSequencing(
        authority=authority, rollup_id=rollup_id, sequencing=sequencing
    )
    return EncodedMsg(msg.type_url, msg.encode())


def deposit_to_rollup_msg(
    *, depositor: str, rollup_id: str, account: BytesLike, amount: Numeric
) -> EncodedMsg:
    """``account`` is the 32-byte qledger-v1 account id to credit."""
    msg = codecs.MsgDepositToRollup(
        depositor=depositor,
        rollup_id=rollup_id,
        account=to_bytes(account),
        amount=_big(amount),
    )
    return EncodedMsg(msg.type_url, msg.encode())


def bond_rollup_submitter_msg(*, submitter: str, rollup_id: str, amount: Numeric) -> EncodedMsg:
    msg = codecs.MsgBondRollupSubmitter(
        submitter=submitter, rollup_id=rollup_id, amount=_big(amount)
    )
    return EncodedMsg(msg.type_url, msg.encode())


def unbond_rollup_submitter_msg(*, submitter: str, rollup_id: str) -> EncodedMsg:
    msg = codecs.MsgUnbondRollupSubmitter(submitter=submitter, rollup_id=rollup_id)
    return EncodedMsg(msg.type_url, msg.encode())


def set_rollup_members_msg(*, creator: str, rollup_id: str, members: Sequence[str]) -> EncodedMsg:
    msg = codecs.MsgSetRollupMembers(creator=creator, rollup_id=rollup_id, members=list(members))
    return EncodedMsg(msg.type_url, msg.encode())


#: ML-KEM-1024's id in the chain's algorithm registry.
ML_KEM_1024_ALGORITHM_ID = 2


def register_kem_key_msg(
    *, sender: str, public_key: BytesLike, algorithm_id: int = ML_KEM_1024_ALGORITHM_ID
) -> EncodedMsg:
    """Publish an ML-KEM-1024 encapsulation key (1568 bytes) in the chain's
    KEM registry (``x/pqc``)."""
    msg = codecs.MsgRegisterKEMKey(
        sender=sender, algorithm_id=int(algorithm_id), public_key=to_bytes(public_key)
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
    "SetVerificationKeyInput",
    "set_verification_key_msg",
    "update_verification_key_msg",
    "post_rollup_data_msg",
    "set_rollup_sequencing_msg",
    "deposit_to_rollup_msg",
    "bond_rollup_submitter_msg",
    "unbond_rollup_submitter_msg",
    "set_rollup_members_msg",
    "ML_KEM_1024_ALGORITHM_ID",
    "register_kem_key_msg",
]
