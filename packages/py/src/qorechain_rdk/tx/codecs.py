"""Hand-written protobuf encoders for the ``qorechain.rdk.v1`` tx messages.

These mirror the on-chain ``rdk`` module's ``tx.proto`` exactly -- field numbers,
wire types, and message names. 64-bit integers are Python ``int``; ``bytes``
fields are ``bytes``. Only the encode path is implemented (decode is not required
to build and broadcast a transaction); the produced bytes are wrapped in a
protobuf ``Any`` with the ``/qorechain.rdk.v1.Msg...`` type URL.

The proto3 wire format used here:

- varint  (wire type 0): ``int64`` / ``uint64`` / ``bool``
- length-delimited (wire type 2): ``string`` / ``bytes``

Default (zero/empty) scalar fields are omitted, exactly as the TS codecs do.
"""

from __future__ import annotations

from dataclasses import dataclass

TYPE_URL_PREFIX = "/qorechain.rdk.v1."


def _varint(value: int) -> bytes:
    """Encode an unsigned varint. ``int64`` negatives are two's-complement 64-bit."""
    if value < 0:
        value += 1 << 64
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _tag(field_number: int, wire_type: int) -> bytes:
    return _varint((field_number << 3) | wire_type)


def _string_field(field_number: int, value: str) -> bytes:
    if value == "":
        return b""
    encoded = value.encode("utf-8")
    return _tag(field_number, 2) + _varint(len(encoded)) + encoded


def _bytes_field(field_number: int, value: bytes) -> bytes:
    if len(value) == 0:
        return b""
    return _tag(field_number, 2) + _varint(len(value)) + value


def _bytes_field_always(field_number: int, value: bytes) -> bytes:
    """Length-delimited field emitted even when empty (for ``repeated bytes``)."""
    return _tag(field_number, 2) + _varint(len(value)) + value


def _varint_field(field_number: int, value: int) -> bytes:
    if value == 0:
        return b""
    return _tag(field_number, 0) + _varint(value)


def _bool_field(field_number: int, value: bool) -> bytes:
    if not value:
        return b""
    return _tag(field_number, 0) + _varint(1)


@dataclass
class MsgCreateRollup:
    creator: str = ""
    rollup_id: str = ""
    profile: str = ""
    vm_type: str = ""
    stake_amount: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgCreateRollup"

    def encode(self) -> bytes:
        return (
            _string_field(1, self.creator)
            + _string_field(2, self.rollup_id)
            + _string_field(3, self.profile)
            + _string_field(4, self.vm_type)
            + _varint_field(5, self.stake_amount)
        )


@dataclass
class MsgSubmitBatch:
    sequencer: str = ""
    rollup_id: str = ""
    batch_index: int = 0
    state_root: bytes = b""
    prev_state_root: bytes = b""
    tx_count: int = 0
    data_hash: bytes = b""
    proof: bytes = b""
    withdrawals_root: bytes = b""

    type_url = f"{TYPE_URL_PREFIX}MsgSubmitBatch"

    def encode(self) -> bytes:
        return (
            _string_field(1, self.sequencer)
            + _string_field(2, self.rollup_id)
            + _varint_field(3, self.batch_index)
            + _bytes_field(4, self.state_root)
            + _bytes_field(5, self.prev_state_root)
            + _varint_field(6, self.tx_count)
            + _bytes_field(7, self.data_hash)
            + _bytes_field(8, self.proof)
            + _bytes_field(9, self.withdrawals_root)
        )


@dataclass
class MsgChallengeBatch:
    challenger: str = ""
    rollup_id: str = ""
    batch_index: int = 0
    proof: bytes = b""

    type_url = f"{TYPE_URL_PREFIX}MsgChallengeBatch"

    def encode(self) -> bytes:
        return (
            _string_field(1, self.challenger)
            + _string_field(2, self.rollup_id)
            + _varint_field(3, self.batch_index)
            + _bytes_field(4, self.proof)
        )


@dataclass
class MsgResolveChallenge:
    resolver: str = ""
    rollup_id: str = ""
    batch_index: int = 0
    fraud_upheld: bool = False

    type_url = f"{TYPE_URL_PREFIX}MsgResolveChallenge"

    def encode(self) -> bytes:
        return (
            _string_field(1, self.resolver)
            + _string_field(2, self.rollup_id)
            + _varint_field(3, self.batch_index)
            + _bool_field(4, self.fraud_upheld)
        )


@dataclass
class MsgPauseRollup:
    creator: str = ""
    rollup_id: str = ""
    reason: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgPauseRollup"

    def encode(self) -> bytes:
        return (
            _string_field(1, self.creator)
            + _string_field(2, self.rollup_id)
            + _string_field(3, self.reason)
        )


@dataclass
class MsgResumeRollup:
    creator: str = ""
    rollup_id: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgResumeRollup"

    def encode(self) -> bytes:
        return _string_field(1, self.creator) + _string_field(2, self.rollup_id)


@dataclass
class MsgStopRollup:
    creator: str = ""
    rollup_id: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgStopRollup"

    def encode(self) -> bytes:
        return _string_field(1, self.creator) + _string_field(2, self.rollup_id)


@dataclass
class MsgExecuteWithdrawal:
    submitter: str = ""
    rollup_id: str = ""
    batch_index: int = 0
    withdrawal_index: int = 0
    recipient: str = ""
    denom: str = ""
    amount: int = 0
    proof: list = None  # list[bytes]

    type_url = f"{TYPE_URL_PREFIX}MsgExecuteWithdrawal"

    def encode(self) -> bytes:
        out = (
            _string_field(1, self.submitter)
            + _string_field(2, self.rollup_id)
            + _varint_field(3, self.batch_index)
            + _varint_field(4, self.withdrawal_index)
            + _string_field(5, self.recipient)
            + _string_field(6, self.denom)
            + _varint_field(7, self.amount)
        )
        for chunk in self.proof or []:
            out += _bytes_field_always(8, bytes(chunk))
        return out


__all__ = [
    "TYPE_URL_PREFIX",
    "MsgCreateRollup",
    "MsgSubmitBatch",
    "MsgChallengeBatch",
    "MsgResolveChallenge",
    "MsgPauseRollup",
    "MsgResumeRollup",
    "MsgStopRollup",
    "MsgExecuteWithdrawal",
]
