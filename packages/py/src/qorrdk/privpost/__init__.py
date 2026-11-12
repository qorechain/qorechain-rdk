"""Private-rollup envelopes (chain v3.2.8+, ``rdk-private-rollups``).

Every post on a private (``privacy="encapsulated"``) rollup is an envelope: the
data encrypted once with AES-256-GCM under a fresh content key, and that key
encapsulated with ML-KEM-1024 to every member's key from the chain's KEM
registry, with a key commitment so all members open the same content. The
chain checks the envelope's structure and that every entry names a current
member's current key; it never decrypts.

Posts, poster, timing, sizes, members, roots and withdrawals stay public.

Layout (all integers big-endian)::

    "QPRV" | 0x01 | be64(epoch) | key_commit(32) | be16(n)
    n x ( be16(len) | member | fingerprint(32) | kem_ciphertext(1568) | wrapped_key(48) )
    ciphertext (AES-256-GCM, zero nonce, AAD = everything before it)

:func:`parse_envelope`, :func:`kem_key_fingerprint` and
:func:`envelope_membership_error` need no cryptography beyond SHA-256.
:func:`seal_envelope`, :func:`open_envelope` and :func:`kem_keypair_from_seed`
use ML-KEM-1024 from ``qorechain-pqc`` (liboqs) and AES-256-GCM from
``pycryptodome`` (installed with ``cosmpy``); they are imported on first use.
"""

from __future__ import annotations

import ctypes
import hashlib
import hmac
import secrets
import struct
from dataclasses import dataclass
from typing import Callable, Optional, Sequence, Union

from ..utils.bytes import to_bytes

BytesLike = Union[str, bytes, bytearray]

_MAGIC = b"QPRV"
_VERSION = 1
#: ML-KEM-1024 ciphertext size.
KEM_CIPHERTEXT_SIZE = 1568
#: ML-KEM-1024 encapsulation (public) key size.
ENCAPSULATION_KEY_SIZE = 1568
#: ML-KEM-1024 expanded decapsulation (secret) key size.
DECAPSULATION_KEY_SIZE = 3168
#: ML-KEM-1024 key seed size (``d || z``).
KEM_SEED_SIZE = 64
_WRAPPED_KEY_SIZE = 48
_MIN_PAYLOAD_SIZE = 16
#: Most members (envelope entries) a private rollup can have.
MAX_ENVELOPE_MEMBERS = 32
_MAX_ADDRESS_LEN = 128
_ZERO_NONCE = bytes(12)
_KEM_ALG = "ML-KEM-1024"


class EnvelopeError(ValueError):
    """An envelope is malformed, or does not open."""


@dataclass
class EnvelopeEntry:
    """One member's entry in an envelope."""

    member: str
    #: SHA-256 of the member's ML-KEM-1024 encapsulation key.
    fingerprint: bytes
    kem_ciphertext: bytes
    wrapped_key: bytes


@dataclass
class Envelope:
    """A parsed envelope."""

    epoch: int
    key_commit: bytes
    entries: list
    ciphertext: bytes
    #: Everything before ``ciphertext``: the payload's additional data.
    header: bytes


@dataclass
class EnvelopeRecipient:
    """A recipient: a member address and its ML-KEM-1024 encapsulation key."""

    member: str
    encapsulation_key: BytesLike


def kem_key_fingerprint(encapsulation_key: BytesLike) -> bytes:
    """The fingerprint the chain matches against a member's registered key."""
    return hashlib.sha256(to_bytes(encapsulation_key)).digest()


def _u16(v: int) -> bytes:
    return struct.pack(">H", v)


def _u32(v: int) -> bytes:
    return struct.pack(">I", v)


def _u64(v: int) -> bytes:
    return struct.pack(">Q", v)


def _hkdf_sha256(ikm: bytes, info: bytes, length: int = 32) -> bytes:
    """HKDF-SHA256 (RFC 5869) with an empty salt (HashLen zero bytes)."""
    prk = hmac.new(bytes(32), ikm, hashlib.sha256).digest()
    out = b""
    block = b""
    counter = 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def _wrap_key(shared_secret: bytes, chain_id: str, rollup_id: str, epoch: int, member: str) -> bytes:
    c = chain_id.encode("utf-8")
    r = rollup_id.encode("utf-8")
    m = member.encode("utf-8")
    info = (
        b"qorechain/rdk/private/v1/wrap"
        + _u32(len(c))
        + c
        + _u32(len(r))
        + r
        + _u64(epoch)
        + _u32(len(m))
        + m
    )
    return _hkdf_sha256(shared_secret, info, 32)


def _key_commit(content_key: bytes) -> bytes:
    return hashlib.sha256(b"qorechain/rdk/private/v1/key" + content_key).digest()


def _gcm_seal(key: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    from Crypto.Cipher import AES

    cipher = AES.new(key, AES.MODE_GCM, nonce=_ZERO_NONCE, mac_len=16)
    if aad:
        cipher.update(aad)
    ct, tag = cipher.encrypt_and_digest(plaintext)
    return ct + tag


def _gcm_open(key: bytes, sealed: bytes, aad: bytes = b"") -> bytes:
    from Crypto.Cipher import AES

    if len(sealed) < 16:
        raise ValueError("sealed data shorter than its tag")
    cipher = AES.new(key, AES.MODE_GCM, nonce=_ZERO_NONCE, mac_len=16)
    if aad:
        cipher.update(aad)
    return cipher.decrypt_and_verify(sealed[:-16], sealed[-16:])


def parse_envelope(data: BytesLike) -> Envelope:
    """Parse an envelope and check every size (not membership: the chain does
    that). Raises :class:`EnvelopeError` when it is malformed."""
    b = to_bytes(data)

    def malformed(why: str) -> EnvelopeError:
        return EnvelopeError(f"privpost: malformed envelope: {why}")

    if len(b) < 5 + 8 + 32 + 2 or b[:4] != _MAGIC or b[4] != _VERSION:
        raise malformed("bad header")
    p = 5
    (epoch,) = struct.unpack_from(">Q", b, p)
    p += 8
    key_commit = b[p : p + 32]
    p += 32
    (n,) = struct.unpack_from(">H", b, p)
    p += 2
    if n == 0 or n > MAX_ENVELOPE_MEMBERS:
        raise malformed(f"{n} entries")
    entries: list[EnvelopeEntry] = []
    for _ in range(n):
        if len(b) - p < 2:
            raise malformed("truncated entry")
        (al,) = struct.unpack_from(">H", b, p)
        p += 2
        if (
            al == 0
            or al > _MAX_ADDRESS_LEN
            or len(b) - p < al + 32 + KEM_CIPHERTEXT_SIZE + _WRAPPED_KEY_SIZE
        ):
            raise malformed("truncated entry")
        member = b[p : p + al].decode("utf-8", errors="replace")
        p += al
        fingerprint = b[p : p + 32]
        p += 32
        kem_ciphertext = b[p : p + KEM_CIPHERTEXT_SIZE]
        p += KEM_CIPHERTEXT_SIZE
        wrapped_key = b[p : p + _WRAPPED_KEY_SIZE]
        p += _WRAPPED_KEY_SIZE
        entries.append(EnvelopeEntry(member, fingerprint, kem_ciphertext, wrapped_key))
    if len(b) - p < _MIN_PAYLOAD_SIZE:
        raise malformed("payload shorter than its tag")
    return Envelope(
        epoch=epoch, key_commit=key_commit, entries=entries, ciphertext=b[p:], header=b[:p]
    )


# --------------------------------------------------------------------------- #
# ML-KEM-1024 (FIPS 203) through liboqs, the library qorechain-pqc wraps.
# --------------------------------------------------------------------------- #


def _oqs():
    import oqs  # installed with qorechain-pqc

    return oqs


def kem_keypair_from_seed(seed: BytesLike) -> tuple[bytes, bytes]:
    """An ML-KEM-1024 key pair ``(public_key, secret_key)`` from a 64-byte seed
    (``d || z``), the form the chain's tooling stores. The secret key (3168
    bytes) or the seed both open envelopes."""
    s = to_bytes(seed)
    if len(s) != KEM_SEED_SIZE:
        raise ValueError(f"privpost: an ML-KEM-1024 seed is 64 bytes, got {len(s)}")
    oqs = _oqs()
    with oqs.KeyEncapsulation(_KEM_ALG) as kem:
        if hasattr(kem, "generate_keypair_seed"):
            public_key = kem.generate_keypair_seed(s)
            return bytes(public_key), bytes(kem.export_secret_key())
        native = oqs.native()
        if not hasattr(native, "OQS_KEM_keypair_derand"):
            raise RuntimeError(
                "privpost: the installed liboqs cannot derive an ML-KEM key from a seed"
            )
        pk = ctypes.create_string_buffer(ENCAPSULATION_KEY_SIZE)
        sk = ctypes.create_string_buffer(DECAPSULATION_KEY_SIZE)
        rv = native.OQS_KEM_keypair_derand(
            kem._kem, ctypes.byref(pk), ctypes.byref(sk), ctypes.create_string_buffer(s, 64)
        )
        if rv != 0:
            raise RuntimeError("privpost: ML-KEM-1024 key derivation failed")
        return bytes(pk), bytes(sk)


def _encapsulate(encapsulation_key: bytes, coins: bytes) -> tuple[bytes, bytes]:
    """FIPS 203 ``Encaps_internal(ek, m)`` with the 32-byte randomness ``m``
    given (what ``Encaps`` draws itself)."""
    oqs = _oqs()
    native = oqs.native()
    if not hasattr(native, "OQS_KEM_encaps_derand"):
        raise RuntimeError(
            "privpost: the installed liboqs has no OQS_KEM_encaps_derand (liboqs 0.12 or "
            "later is needed to seal envelopes)"
        )
    with oqs.KeyEncapsulation(_KEM_ALG) as kem:
        ct = ctypes.create_string_buffer(KEM_CIPHERTEXT_SIZE)
        ss = ctypes.create_string_buffer(32)
        rv = native.OQS_KEM_encaps_derand(
            kem._kem,
            ctypes.byref(ct),
            ctypes.byref(ss),
            ctypes.create_string_buffer(encapsulation_key, ENCAPSULATION_KEY_SIZE),
            ctypes.create_string_buffer(coins, 32),
        )
        if rv != 0:
            raise RuntimeError("privpost: ML-KEM-1024 encapsulation failed")
        return bytes(ct), bytes(ss)


def _decapsulate(secret_key: bytes, ciphertext: bytes) -> bytes:
    from qorpqc import mlkem

    return mlkem.decapsulate(secret_key, ciphertext)


def seal_envelope(
    *,
    chain_id: str,
    rollup_id: str,
    epoch: int,
    recipients: Sequence[EnvelopeRecipient],
    plaintext: BytesLike,
    random: Optional[Callable[[int], bytes]] = None,
) -> bytes:
    """Encrypt ``plaintext`` to ``recipients`` (in the rollup's member order)
    for a rollup at its current membership epoch. Post the result with
    ``RdkTxClient.post_rollup_data``.

    ``random`` returns ``n`` random bytes (defaults to :func:`secrets.token_bytes`);
    pass a deterministic one only in tests. ``recipients`` may also be
    ``(member, encapsulation_key)`` pairs or dicts with those keys.
    """
    rs = [_recipient(r) for r in recipients]
    if len(rs) == 0 or len(rs) > MAX_ENVELOPE_MEMBERS:
        raise ValueError(
            f"privpost: {len(rs)} recipients (1 to {MAX_ENVELOPE_MEMBERS})"
        )
    rand = random or secrets.token_bytes
    epoch = int(epoch)
    content_key = bytes(rand(32))
    out = _MAGIC + bytes([_VERSION]) + _u64(epoch) + _key_commit(content_key) + _u16(len(rs))
    for r in rs:
        member = r.member.encode("utf-8")
        if len(member) == 0 or len(member) > _MAX_ADDRESS_LEN:
            raise ValueError(f'privpost: member "{r.member}"')
        ek = to_bytes(r.encapsulation_key)
        if len(ek) != ENCAPSULATION_KEY_SIZE:
            raise ValueError(
                f"privpost: key of {r.member} is {len(ek)} bytes, want {ENCAPSULATION_KEY_SIZE}"
            )
        cipher_text, shared_secret = _encapsulate(ek, bytes(rand(32)))
        wrapped = _gcm_seal(
            _wrap_key(shared_secret, chain_id, rollup_id, epoch, r.member), content_key
        )
        out += _u16(len(member)) + member + kem_key_fingerprint(ek) + cipher_text + wrapped
    header = out
    return header + _gcm_seal(content_key, to_bytes(plaintext), header)


def open_envelope(
    *,
    envelope: BytesLike,
    chain_id: str,
    rollup_id: str,
    member: str,
    decapsulation_key: BytesLike,
) -> bytes:
    """Decrypt an envelope as ``member``. ``decapsulation_key`` is the 64-byte
    seed or the 3168-byte expanded secret key.

    Raises :class:`EnvelopeError` if the member has no entry, the key does not
    open it, or the content key does not match the envelope's commitment.
    """
    e = parse_envelope(envelope)
    dk = to_bytes(decapsulation_key)
    if len(dk) == KEM_SEED_SIZE:
        secret_key = kem_keypair_from_seed(dk)[1]
    elif len(dk) == DECAPSULATION_KEY_SIZE:
        secret_key = dk
    else:
        raise ValueError(
            f"privpost: an ML-KEM-1024 key is 64 (seed) or 3168 bytes, got {len(dk)}"
        )
    entry = next((en for en in e.entries if en.member == member), None)
    if entry is None:
        raise EnvelopeError("privpost: the envelope has no entry for this member")
    ss = _decapsulate(secret_key, entry.kem_ciphertext)
    try:
        content_key = _gcm_open(
            _wrap_key(ss, chain_id, rollup_id, e.epoch, member), entry.wrapped_key
        )
    except ValueError:
        raise EnvelopeError("privpost: the envelope does not open with this key") from None
    if not hmac.compare_digest(_key_commit(content_key), e.key_commit):
        raise EnvelopeError(
            "privpost: the content key does not match the envelope's commitment"
        )
    try:
        return _gcm_open(content_key, e.ciphertext, e.header)
    except ValueError:
        raise EnvelopeError("privpost: the envelope does not open with this key") from None


def _recipient(r) -> EnvelopeRecipient:
    if isinstance(r, EnvelopeRecipient):
        return r
    if isinstance(r, dict):
        return EnvelopeRecipient(member=r["member"], encapsulation_key=r["encapsulation_key"])
    member, key = r
    return EnvelopeRecipient(member=member, encapsulation_key=key)


def envelope_membership_error(
    envelope: BytesLike,
    *,
    members_epoch: int,
    members: Sequence[EnvelopeRecipient],
) -> Optional[str]:
    """Why the chain would refuse ``envelope`` as a post on a private rollup,
    or ``None`` if it would accept its structure. Mirrors the chain's check:
    the envelope's epoch is the rollup's membership epoch, there is one entry
    per member in the rollup's order, and each entry names that member's
    registered ML-KEM-1024 key. It does not decrypt.

    ``members`` are the rollup's members in order, each with its registered
    encapsulation key (:class:`EnvelopeRecipient`, ``(member, key)`` pairs or
    dicts).
    """
    ms = [_recipient(m) for m in members]
    if len(ms) == 0:
        return "the rollup has no members yet"
    try:
        e = parse_envelope(envelope)
    except (EnvelopeError, ValueError) as err:
        return str(err)
    if e.epoch != int(members_epoch):
        return f"envelope epoch {e.epoch}, the rollup's membership epoch is {members_epoch}"
    if len(e.entries) != len(ms):
        return f"{len(e.entries)} entries for {len(ms)} members"
    for i, (want, got) in enumerate(zip(ms, e.entries)):
        if got.member != want.member:
            return f"entry {i} is for {got.member}, member {i} is {want.member}"
        if not hmac.compare_digest(got.fingerprint, kem_key_fingerprint(want.encapsulation_key)):
            return f"entry {i} does not name {want.member}'s registered KEM key"
    return None


__all__ = [
    "KEM_CIPHERTEXT_SIZE",
    "ENCAPSULATION_KEY_SIZE",
    "DECAPSULATION_KEY_SIZE",
    "KEM_SEED_SIZE",
    "MAX_ENVELOPE_MEMBERS",
    "EnvelopeError",
    "EnvelopeEntry",
    "Envelope",
    "EnvelopeRecipient",
    "kem_key_fingerprint",
    "parse_envelope",
    "kem_keypair_from_seed",
    "seal_envelope",
    "open_envelope",
    "envelope_membership_error",
]
