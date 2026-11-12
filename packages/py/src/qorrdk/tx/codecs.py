"""Hand-written protobuf encoders for the ``qorechain.rdk.v1`` tx messages.

These mirror the on-chain ``rdk`` module's ``tx.proto`` exactly -- field numbers,
wire types, and message names. 64-bit integers are Python ``int``; ``bytes``
fields are ``bytes``. The encode path is what building and broadcasting a
transaction needs; the table-driven messages added for chain v3.2.7 and v3.2.8
also decode (to read their responses). The produced bytes are wrapped in a
protobuf ``Any`` with the ``/qorechain.rdk.v1.Msg...`` type URL.

The proto3 wire format used here:

- varint  (wire type 0): ``int64`` / ``uint64`` / ``bool``
- length-delimited (wire type 2): ``string`` / ``bytes``

Default (zero/empty) scalar fields are omitted, exactly as the TS codecs do.
"""

from __future__ import annotations

from dataclasses import dataclass, field

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
    #: Field 6 (chain v3.2.7+): the rollup's ZK verification key, registered at
    #: creation, in the encoding ``MsgSetVerificationKey`` takes. Empty: none.
    verification_key: bytes = b""
    #: Field 7 (chain v3.2.8+): ``""`` (the rollup's sequencer settles) or
    #: ``"based"`` (transactions are ordered by their inclusion on the chain and
    #: every batch consumes the inbox in order). zk (snark), based settlement,
    #: and qledger-v1 optimistic rollups only.
    sequencing: str = ""
    #: Field 8 (chain v3.2.8+): ``""`` or ``"qledger-v1"`` (optimistic, must be based).
    execution_vm: str = ""
    #: Field 9 (chain v3.2.8+): ``""`` or ``"encapsulated"`` (zk with a Groth16 key only).
    privacy: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgCreateRollup"

    def encode(self) -> bytes:
        return (
            _string_field(1, self.creator)
            + _string_field(2, self.rollup_id)
            + _string_field(3, self.profile)
            + _string_field(4, self.vm_type)
            + _varint_field(5, self.stake_amount)
            + _bytes_field(6, self.verification_key)
            + _string_field(7, self.sequencing)
            + _string_field(8, self.execution_vm)
            + _string_field(9, self.privacy)
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
    #: Field 12 (chain v3.2.8+): for a based rollup, the inbox sequence of the
    #: last post this batch consumes; ``data_hash`` must then be the inbox range
    #: commitment. Zero for every other rollup.
    inbox_end: int = 0

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
            + _varint_field(12, self.inbox_end)
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


# ---------------------------------------------------------------------------
# Messages added in chain v3.2.7 (verification keys) and v3.2.8 (posted data,
# based sequencing, qledger-v1 rollups, private rollups). They hold only
# string, bytes, unsigned varint and repeated-string fields, so one
# table-driven codec serves all of them, with a decoder for the responses.
# ---------------------------------------------------------------------------

#: Type URL prefix of the ``x/pqc`` messages (the KEM key registry).
PQC_TYPE_URL_PREFIX = "/qorechain.pqc.v1."

_STRING = "string"
_BYTES = "bytes"
_UINT = "uint"  # uint64 / uint32: the same varint on the wire
_REPEATED_STRING = "repeated_string"


def _read_varint(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(data):
            raise ValueError("truncated varint")
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7
        if shift >= 70:
            raise ValueError("varint too long")


class _TableMsg:
    """A protobuf message described by ``_FIELDS``: ``(number, attr, kind)``."""

    _FIELDS: tuple = ()
    type_url = ""

    def encode(self) -> bytes:
        out = b""
        for number, attr, kind in self._FIELDS:
            value = getattr(self, attr)
            if kind == _STRING:
                out += _string_field(number, value)
            elif kind == _BYTES:
                out += _bytes_field(number, bytes(value))
            elif kind == _UINT:
                out += _varint_field(number, int(value))
            else:
                for item in value or []:
                    encoded = item.encode("utf-8")
                    out += _tag(number, 2) + _varint(len(encoded)) + encoded
        return out

    @classmethod
    def decode(cls, data: bytes):
        """Decode protobuf bytes; unknown fields are skipped."""
        by_number = {f[0]: f for f in cls._FIELDS}
        msg = cls()
        for _, attr, kind in cls._FIELDS:
            if kind == _REPEATED_STRING:
                setattr(msg, attr, [])
        data = bytes(data)
        pos = 0
        while pos < len(data):
            key, pos = _read_varint(data, pos)
            number, wire = key >> 3, key & 7
            if wire == 0:
                value, pos = _read_varint(data, pos)
            elif wire == 2:
                length, pos = _read_varint(data, pos)
                if pos + length > len(data):
                    raise ValueError("truncated field")
                value = data[pos : pos + length]
                pos += length
            elif wire == 1:
                pos += 8
                continue
            elif wire == 5:
                pos += 4
                continue
            else:
                raise ValueError(f"unsupported wire type {wire}")
            spec = by_number.get(number)
            if spec is None:
                continue
            _, attr, kind = spec
            if kind == _STRING:
                setattr(msg, attr, bytes(value).decode("utf-8"))
            elif kind == _BYTES:
                setattr(msg, attr, bytes(value))
            elif kind == _UINT:
                setattr(msg, attr, int(value))
            else:
                getattr(msg, attr).append(bytes(value).decode("utf-8"))
        return msg


@dataclass
class MsgSetVerificationKey(_TableMsg):
    """Registers or replaces a zk rollup's verification key (chain v3.2.7+).

    Signed by the creator, before the rollup's first batch only. For ``snark``
    the key is a Groth16 BLS12-381 verifying key in gnark's binary encoding for
    a circuit with exactly four public inputs (prev_state_root, state_root,
    data_hash, withdrawals_root). From v3.2.8 a ``stark`` key is refused.
    """

    creator: str = ""
    rollup_id: str = ""
    verification_key: bytes = b""
    #: ``"snark"``, or empty to keep the rollup's proof system.
    proof_system: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgSetVerificationKey"
    _FIELDS = (
        (1, "creator", _STRING),
        (2, "rollup_id", _STRING),
        (3, "verification_key", _BYTES),
        (4, "proof_system", _STRING),
    )


@dataclass
class MsgUpdateVerificationKey(_TableMsg):
    """Governance-only key replacement (chain v3.2.7+); ``authority`` is the
    gov module account."""

    authority: str = ""
    rollup_id: str = ""
    verification_key: bytes = b""
    proof_system: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgUpdateVerificationKey"
    _FIELDS = (
        (1, "authority", _STRING),
        (2, "rollup_id", _STRING),
        (3, "verification_key", _BYTES),
        (4, "proof_system", _STRING),
    )


@dataclass
class MsgPostRollupData(_TableMsg):
    """Puts rollup data on chain (chain v3.2.8+).

    The chain keeps a commitment (SHA-256 of ``data``) under the rollup's next
    inbox sequence; a native-DA batch may then carry that SHA-256 as its
    ``data_hash``. Who may post: the rollup's sequencer (its creator when none
    is set); anyone on a based rollup.
    """

    poster: str = ""
    rollup_id: str = ""
    data: bytes = b""

    type_url = f"{TYPE_URL_PREFIX}MsgPostRollupData"
    _FIELDS = (
        (1, "poster", _STRING),
        (2, "rollup_id", _STRING),
        (3, "data", _BYTES),
    )


@dataclass
class MsgPostRollupDataResponse(_TableMsg):
    #: The inbox sequence the post was given (from 1).
    sequence: int = 0
    #: SHA-256 of the data: the hash a batch references.
    data_hash: bytes = b""

    type_url = f"{TYPE_URL_PREFIX}MsgPostRollupDataResponse"
    _FIELDS = ((1, "sequence", _UINT), (2, "data_hash", _BYTES))


@dataclass
class MsgSetRollupSequencing(_TableMsg):
    """Governance-only move to based sequencing (``"based"``) or back
    (``""``), chain v3.2.8+."""

    authority: str = ""
    rollup_id: str = ""
    sequencing: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgSetRollupSequencing"
    _FIELDS = (
        (1, "authority", _STRING),
        (2, "rollup_id", _STRING),
        (3, "sequencing", _STRING),
    )


@dataclass
class MsgDepositToRollup(_TableMsg):
    """Moves ``amount`` uqor into a qledger-v1 rollup's deposit pool and
    credits the 32-byte L2 ``account`` through the rollup's inbox (chain
    v3.2.8+). At least 1 QOR (1,000,000 uqor)."""

    depositor: str = ""
    rollup_id: str = ""
    account: bytes = b""
    amount: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgDepositToRollup"
    _FIELDS = (
        (1, "depositor", _STRING),
        (2, "rollup_id", _STRING),
        (3, "account", _BYTES),
        (4, "amount", _UINT),
    )


@dataclass
class MsgDepositToRollupResponse(_TableMsg):
    #: The inbox sequence of the deposit entry.
    sequence: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgDepositToRollupResponse"
    _FIELDS = ((1, "sequence", _UINT),)


@dataclass
class MsgBondRollupSubmitter(_TableMsg):
    """Adds ``amount`` uqor to the submitter's bond on a qledger-v1 rollup
    (chain v3.2.8+)."""

    submitter: str = ""
    rollup_id: str = ""
    amount: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgBondRollupSubmitter"
    _FIELDS = (
        (1, "submitter", _STRING),
        (2, "rollup_id", _STRING),
        (3, "amount", _UINT),
    )


@dataclass
class MsgBondRollupSubmitterResponse(_TableMsg):
    bond: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgBondRollupSubmitterResponse"
    _FIELDS = ((1, "bond", _UINT),)


@dataclass
class MsgUnbondRollupSubmitter(_TableMsg):
    """Returns the submitter's whole bond, a full challenge window after its
    last batch (chain v3.2.8+)."""

    submitter: str = ""
    rollup_id: str = ""

    type_url = f"{TYPE_URL_PREFIX}MsgUnbondRollupSubmitter"
    _FIELDS = ((1, "submitter", _STRING), (2, "rollup_id", _STRING))


@dataclass
class MsgUnbondRollupSubmitterResponse(_TableMsg):
    returned: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgUnbondRollupSubmitterResponse"
    _FIELDS = ((1, "returned", _UINT),)


@dataclass
class MsgSetRollupMembers(_TableMsg):
    """Sets a private rollup's member list (chain v3.2.8+): at most 32
    canonical account addresses, each with a registered ML-KEM-1024 key.
    Signed by the creator; each change starts a new membership epoch."""

    creator: str = ""
    rollup_id: str = ""
    members: list = field(default_factory=list)  # list[str]

    type_url = f"{TYPE_URL_PREFIX}MsgSetRollupMembers"
    _FIELDS = (
        (1, "creator", _STRING),
        (2, "rollup_id", _STRING),
        (3, "members", _REPEATED_STRING),
    )


@dataclass
class MsgSetRollupMembersResponse(_TableMsg):
    epoch: int = 0

    type_url = f"{TYPE_URL_PREFIX}MsgSetRollupMembersResponse"
    _FIELDS = ((1, "epoch", _UINT),)


@dataclass
class MsgRegisterKEMKey(_TableMsg):
    """Publishes the sender's key-encapsulation public key in the chain's KEM
    registry (``x/pqc``, chain v3.2.5+). A private rollup's members need an
    ML-KEM-1024 key there (``algorithm_id`` 2, the 1568-byte FIPS 203
    encapsulation key)."""

    sender: str = ""
    algorithm_id: int = 0
    public_key: bytes = b""

    type_url = f"{PQC_TYPE_URL_PREFIX}MsgRegisterKEMKey"
    _FIELDS = (
        (1, "sender", _STRING),
        (2, "algorithm_id", _UINT),
        (3, "public_key", _BYTES),
    )


__all__ = [
    "TYPE_URL_PREFIX",
    "PQC_TYPE_URL_PREFIX",
    "MsgCreateRollup",
    "MsgSubmitBatch",
    "MsgChallengeBatch",
    "MsgResolveChallenge",
    "MsgPauseRollup",
    "MsgResumeRollup",
    "MsgStopRollup",
    "MsgExecuteWithdrawal",
    "MsgSetVerificationKey",
    "MsgUpdateVerificationKey",
    "MsgPostRollupData",
    "MsgPostRollupDataResponse",
    "MsgSetRollupSequencing",
    "MsgDepositToRollup",
    "MsgDepositToRollupResponse",
    "MsgBondRollupSubmitter",
    "MsgBondRollupSubmitterResponse",
    "MsgUnbondRollupSubmitter",
    "MsgUnbondRollupSubmitterResponse",
    "MsgSetRollupMembers",
    "MsgSetRollupMembersResponse",
    "MsgRegisterKEMKey",
]
