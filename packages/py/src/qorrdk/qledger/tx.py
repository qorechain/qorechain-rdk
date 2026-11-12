"""qledger-v1 transactions and deposits (chain v3.2.8+, ``rdk-optimistic-reexec``).

A qledger-v1 rollup is a uqor account ledger. Its inputs are the rollup's
inbox entries: user posts carrying one signed transaction each, and deposit
entries the chain appends for ``MsgDepositToRollup``::

    tx       = 0x01 | scheme | public_key | kind | be64(nonce) | body | be64(amount) | signature
    transfer = to[32]
    withdraw = u8(len) | recipient (bech32)

The only scheme is ML-DSA-44 (``scheme`` 1), signed deterministically with the
FIPS 204 context ``"qledger/v1"`` over
``SHA-256("qledger/v1/tx" | lp(chain_id) | lp(rollup_id) | unsigned)``.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass, replace
from typing import Optional, Union

from ..utils.bytes import to_bytes

BytesLike = Union[str, bytes, bytearray]

#: ML-DSA-44, the only qledger-v1 account scheme.
QLEDGER_SCHEME_MLDSA44 = 1
#: Transaction kinds.
QLEDGER_KIND_TRANSFER = 1
QLEDGER_KIND_WITHDRAW = 2
#: Longest withdrawal recipient (a bech32 address).
QLEDGER_MAX_RECIPIENT_LEN = 90
#: Poster prefix of the inbox entries the chain writes for deposits.
QLEDGER_DEPOSIT_POSTER_PREFIX = "deposit:"

_TX_VERSION = 1
_MLDSA44_PUBLIC_KEY_SIZE = 1312
_MLDSA44_SIGNATURE_SIZE = 2420
_CONTEXT = b"qledger/v1"
_DEPOSIT_MAGIC = b"QLDP"
_MAX_U64 = (1 << 64) - 1


def _ml_dsa_44():
    from dilithium_py.ml_dsa import ML_DSA_44

    return ML_DSA_44


def be64(v: int) -> bytes:
    """``v`` as 8 big-endian bytes."""
    return struct.pack(">Q", int(v))


def _lp(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


@dataclass
class QledgerTx:
    """A qledger-v1 transaction. ``to`` is set for a transfer, ``recipient``
    for a withdrawal."""

    scheme: int
    public_key: bytes
    kind: int
    nonce: int
    amount: int
    signature: bytes = b""
    to: Optional[bytes] = None
    recipient: Optional[str] = None


@dataclass
class QledgerKeypair:
    """An ML-DSA-44 account key pair and the account id it controls."""

    public_key: bytes
    secret_key: bytes
    account_id: bytes


@dataclass
class QledgerDeposit:
    """A parsed deposit entry payload."""

    account: bytes
    amount: int


def qledger_account_id(public_key: BytesLike, scheme: int = QLEDGER_SCHEME_MLDSA44) -> bytes:
    """The account id a public key controls:
    ``SHA-256("qledger/v1/account" | scheme | public_key)``."""
    return hashlib.sha256(b"qledger/v1/account" + bytes([scheme]) + to_bytes(public_key)).digest()


def qledger_keypair_from_seed(seed: BytesLike) -> QledgerKeypair:
    """An ML-DSA-44 account key pair from a 32-byte seed (FIPS 204 key
    generation), and its account id."""
    s = to_bytes(seed)
    if len(s) != 32:
        raise ValueError(f"qledger: an ML-DSA-44 seed is 32 bytes, got {len(s)}")
    public_key, secret_key = _ml_dsa_44().key_derive(s)
    return QledgerKeypair(
        public_key=public_key, secret_key=secret_key, account_id=qledger_account_id(public_key)
    )


def qledger_tx_unsigned(tx: QledgerTx) -> bytes:
    """The encoding without the signature."""
    out = bytes([_TX_VERSION, tx.scheme]) + bytes(tx.public_key) + bytes([tx.kind]) + be64(tx.nonce)
    if tx.kind == QLEDGER_KIND_TRANSFER:
        to = bytes(32) if tx.to is None else bytes(tx.to)
        if len(to) != 32:
            raise ValueError("qledger: a transfer's `to` is a 32-byte account id")
        out += to
    elif tx.kind == QLEDGER_KIND_WITHDRAW:
        r = (tx.recipient or "").encode("utf-8", "surrogateescape")
        if len(r) > 255:
            raise ValueError("qledger: recipient too long")
        out += bytes([len(r)]) + r
    return out + be64(tx.amount)


def encode_qledger_tx(tx: QledgerTx) -> bytes:
    """The transaction as posted."""
    return qledger_tx_unsigned(tx) + bytes(tx.signature)


def qledger_signing_message(chain_id: str, rollup_id: str, unsigned: BytesLike) -> bytes:
    """What an account signs: the transaction bound to one chain and one rollup."""
    return hashlib.sha256(
        b"qledger/v1/tx"
        + _lp(chain_id.encode("utf-8"))
        + _lp(rollup_id.encode("utf-8"))
        + to_bytes(unsigned)
    ).digest()


def sign_qledger_tx(
    *,
    chain_id: str,
    rollup_id: str,
    secret_key: bytes,
    public_key: bytes,
    nonce: int,
    amount: int,
    to: Optional[BytesLike] = None,
    recipient: Optional[str] = None,
) -> QledgerTx:
    """Build and sign (deterministically) a transfer to the 32-byte account id
    ``to``, or a withdrawal to the canonical ``qor1`` address ``recipient``.
    Post the result (:func:`encode_qledger_tx`) with ``post_rollup_data``; one
    transaction per post."""
    if (to is None) == (recipient is None):
        raise ValueError("qledger: give exactly one of `to` (transfer) or `recipient` (withdrawal)")
    nonce, amount = int(nonce), int(amount)
    if not (0 <= nonce <= _MAX_U64 and 0 <= amount <= _MAX_U64):
        raise ValueError("qledger: nonce and amount are unsigned 64-bit values")
    if recipient is not None:
        n = len(recipient.encode("utf-8", "surrogateescape"))
        if n == 0 or n > QLEDGER_MAX_RECIPIENT_LEN:
            raise ValueError(
                f"qledger: a withdrawal recipient is 1 to {QLEDGER_MAX_RECIPIENT_LEN} bytes, "
                f"got {n} (the chain would ignore the transaction)"
            )
    tx = QledgerTx(
        scheme=QLEDGER_SCHEME_MLDSA44,
        public_key=bytes(public_key),
        kind=QLEDGER_KIND_TRANSFER if to is not None else QLEDGER_KIND_WITHDRAW,
        nonce=nonce,
        amount=amount,
        to=to_bytes(to) if to is not None else None,
        recipient=recipient,
    )
    msg = qledger_signing_message(chain_id, rollup_id, qledger_tx_unsigned(tx))
    signature = _ml_dsa_44().sign(bytes(secret_key), msg, ctx=_CONTEXT, deterministic=True)
    return replace(tx, signature=signature)


def decode_qledger_tx(data: BytesLike) -> Optional[QledgerTx]:
    """Parse a posted payload; ``None`` for anything that is not exactly one
    well-formed transaction."""
    try:
        b = to_bytes(data)
    except ValueError:
        return None
    if len(b) < 2 or b[0] != _TX_VERSION or b[1] != QLEDGER_SCHEME_MLDSA44:
        return None
    p = 2
    if len(b) < p + _MLDSA44_PUBLIC_KEY_SIZE + 1 + 8:
        return None
    public_key = b[p : p + _MLDSA44_PUBLIC_KEY_SIZE]
    p += _MLDSA44_PUBLIC_KEY_SIZE
    kind = b[p]
    p += 1
    (nonce,) = struct.unpack_from(">Q", b, p)
    p += 8
    to: Optional[bytes] = None
    recipient: Optional[str] = None
    if kind == QLEDGER_KIND_TRANSFER:
        if len(b) < p + 32:
            return None
        to = b[p : p + 32]
        p += 32
    elif kind == QLEDGER_KIND_WITHDRAW:
        if len(b) < p + 1:
            return None
        n = b[p]
        p += 1
        if n == 0 or n > QLEDGER_MAX_RECIPIENT_LEN or len(b) < p + n:
            return None
        # surrogateescape keeps any byte string exact, as the chain does.
        recipient = b[p : p + n].decode("utf-8", "surrogateescape")
        p += n
    else:
        return None
    if len(b) != p + 8 + _MLDSA44_SIGNATURE_SIZE:
        return None
    (amount,) = struct.unpack_from(">Q", b, p)
    p += 8
    return QledgerTx(
        scheme=QLEDGER_SCHEME_MLDSA44,
        public_key=public_key,
        kind=kind,
        nonce=nonce,
        amount=amount,
        signature=b[p:],
        to=to,
        recipient=recipient,
    )


def verify_qledger_tx(tx: QledgerTx, chain_id: str, rollup_id: str) -> bool:
    """Whether ``tx`` carries a valid signature for ``chain_id`` / ``rollup_id``."""
    if (
        tx.scheme != QLEDGER_SCHEME_MLDSA44
        or len(tx.public_key) != _MLDSA44_PUBLIC_KEY_SIZE
        or len(tx.signature) != _MLDSA44_SIGNATURE_SIZE
    ):
        return False
    try:
        msg = qledger_signing_message(chain_id, rollup_id, qledger_tx_unsigned(tx))
        return bool(
            _ml_dsa_44().verify(bytes(tx.public_key), msg, bytes(tx.signature), ctx=_CONTEXT)
        )
    except Exception:  # noqa: BLE001 - any malformed input is simply not valid
        return False


def encode_qledger_deposit(account: BytesLike, amount: int) -> bytes:
    """The payload of a deposit entry: ``"QLDP" | account[32] | be64(amount)``."""
    a = to_bytes(account)
    if len(a) != 32:
        raise ValueError("qledger: an account id is 32 bytes")
    return _DEPOSIT_MAGIC + a + be64(amount)


def decode_qledger_deposit(data: BytesLike) -> Optional[QledgerDeposit]:
    """Parse a deposit payload; ``None`` when it is not one."""
    try:
        b = to_bytes(data)
    except ValueError:
        return None
    if len(b) != 44 or b[:4] != _DEPOSIT_MAGIC:
        return None
    return QledgerDeposit(account=b[4:36], amount=struct.unpack_from(">Q", b, 36)[0])


__all__ = [
    "QLEDGER_SCHEME_MLDSA44",
    "QLEDGER_KIND_TRANSFER",
    "QLEDGER_KIND_WITHDRAW",
    "QLEDGER_MAX_RECIPIENT_LEN",
    "QLEDGER_DEPOSIT_POSTER_PREFIX",
    "QledgerTx",
    "QledgerKeypair",
    "QledgerDeposit",
    "qledger_account_id",
    "qledger_keypair_from_seed",
    "qledger_tx_unsigned",
    "encode_qledger_tx",
    "qledger_signing_message",
    "sign_qledger_tx",
    "decode_qledger_tx",
    "verify_qledger_tx",
    "encode_qledger_deposit",
    "decode_qledger_deposit",
]
