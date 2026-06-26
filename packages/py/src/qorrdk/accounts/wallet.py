"""Native account derivation and a secp256k1 SIGN_MODE_DIRECT signer.

Derivation follows BIP-39 (mnemonic -> seed) and BIP-32/BIP-44 with the Cosmos
coin type 118 and path ``m/44'/118'/0'/0/0``. The account key is secp256k1; the
address is ``ripemd160(sha256(compressed_pubkey))`` encoded as bech32 with the
``qor`` prefix.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import struct
from dataclasses import dataclass
from typing import Mapping, Optional

import bech32
import ecdsa
from ecdsa.curves import SECP256k1
from mnemonic import Mnemonic

from ..constants import ACCOUNT_PREFIX
from ..utils.bytes import to_bytes

#: The Cosmos BIP-44 derivation path: m/44'/118'/0'/0/0.
COSMOS_HD_PATH: tuple[int, ...] = (44, 118, 0, 0, 0)
_HARDENED = 0x80000000
_CURVE_ORDER = SECP256k1.order


def _hmac_sha512(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha512).digest()


def _compressed_pubkey(priv: bytes) -> bytes:
    sk = ecdsa.SigningKey.from_string(priv, curve=SECP256k1)
    point = sk.get_verifying_key().pubkey.point
    prefix = b"\x02" if point.y() % 2 == 0 else b"\x03"
    return prefix + point.x().to_bytes(32, "big")


def _ckd_priv(key: bytes, chain_code: bytes, index: int) -> tuple[bytes, bytes]:
    if index & _HARDENED:
        data = b"\x00" + key + struct.pack(">I", index)
    else:
        data = _compressed_pubkey(key) + struct.pack(">I", index)
    digest = _hmac_sha512(chain_code, data)
    il = int.from_bytes(digest[:32], "big")
    child = (il + int.from_bytes(key, "big")) % _CURVE_ORDER
    return child.to_bytes(32, "big"), digest[32:]


def _derive_private_key(seed: bytes, path: tuple[int, ...] = COSMOS_HD_PATH) -> bytes:
    master = _hmac_sha512(b"Bitcoin seed", seed)
    key, chain_code = master[:32], master[32:]
    # Path m/44'/118'/0'/0/0: first three levels hardened, last two not.
    indices = (
        path[0] | _HARDENED,
        path[1] | _HARDENED,
        path[2] | _HARDENED,
        path[3],
        path[4],
    )
    for index in indices:
        key, chain_code = _ckd_priv(key, chain_code, index)
    return key


def _address_from_pubkey(compressed: bytes, prefix: str) -> str:
    sha = hashlib.sha256(compressed).digest()
    ripe = hashlib.new("ripemd160", sha).digest()
    words = bech32.convertbits(list(ripe), 8, 5, True)
    if words is None:  # pragma: no cover - defensive
        raise ValueError("failed to bech32-encode address")
    return bech32.bech32_encode(prefix, words)


@dataclass
class NativeAccount:
    """A derived native account: keys and bech32 address."""

    address: str
    private_key: bytes
    public_key: bytes

    @property
    def private_key_hex(self) -> str:
        return self.private_key.hex()


def generate_mnemonic(strength: int = 128) -> str:
    """Generate a fresh BIP-39 mnemonic (default 12 words)."""
    return Mnemonic("english").generate(strength=strength)


def validate_mnemonic(mnemonic: str) -> bool:
    """Whether ``mnemonic`` is a valid BIP-39 English mnemonic."""
    return Mnemonic("english").check(mnemonic.strip())


def derive_native_account(
    mnemonic: str,
    *,
    passphrase: str = "",
    prefix: str = ACCOUNT_PREFIX,
    path: tuple[int, ...] = COSMOS_HD_PATH,
) -> NativeAccount:
    """Derive a native account from a BIP-39 mnemonic.

    Uses the Cosmos BIP-44 path ``m/44'/118'/0'/0/0`` over secp256k1 and bech32
    address encoding with ``prefix`` (default ``qor``).
    """
    seed = Mnemonic.to_seed(mnemonic.strip(), passphrase)
    priv = _derive_private_key(seed, path)
    pub = _compressed_pubkey(priv)
    address = _address_from_pubkey(pub, prefix)
    return NativeAccount(address=address, private_key=priv, public_key=pub)


class Signer:
    """A secp256k1 SIGN_MODE_DIRECT signer over a single account."""

    def __init__(self, private_key: bytes, prefix: str = ACCOUNT_PREFIX) -> None:
        if len(private_key) != 32:
            raise ValueError("private key must be 32 bytes")
        self._private_key = bytes(private_key)
        self._public_key = _compressed_pubkey(self._private_key)
        self._address = _address_from_pubkey(self._public_key, prefix)

    @property
    def address(self) -> str:
        return self._address

    @property
    def public_key(self) -> bytes:
        """The 33-byte compressed secp256k1 public key."""
        return self._public_key

    @property
    def private_key(self) -> bytes:
        return self._private_key

    def sign_digest(self, digest: bytes) -> bytes:
        """Sign a 32-byte digest, returning a 64-byte (r||s) low-S signature."""
        sk = ecdsa.SigningKey.from_string(self._private_key, curve=SECP256k1)
        sig = sk.sign_digest_deterministic(
            digest, hashfunc=hashlib.sha256, sigencode=ecdsa.util.sigencode_string
        )
        return _normalize_low_s(sig)

    def sign(self, message: bytes) -> bytes:
        """Sign ``message`` (sha256 is applied), returning a 64-byte signature."""
        return self.sign_digest(hashlib.sha256(message).digest())

    def verify_digest(self, digest: bytes, signature: bytes) -> bool:
        """Verify a 64-byte signature over a 32-byte digest with this key."""
        vk = ecdsa.VerifyingKey.from_string(self._public_key, curve=SECP256k1)
        try:
            return vk.verify_digest(
                signature, digest, sigdecode=ecdsa.util.sigdecode_string
            )
        except ecdsa.BadSignatureError:
            return False


def _normalize_low_s(signature: bytes) -> bytes:
    """Force the signature's S value into the lower half (Cosmos requirement)."""
    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    if s > _CURVE_ORDER // 2:
        s = _CURVE_ORDER - s
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def signer_from_private_key(
    private_key, prefix: str = ACCOUNT_PREFIX
) -> Signer:
    """Build a :class:`Signer` from a 32-byte key (bytes or hex string)."""
    return Signer(to_bytes(private_key), prefix)


def signer_from_env(
    env: Optional[Mapping[str, Optional[str]]] = None,
    prefix: str = ACCOUNT_PREFIX,
) -> Optional[Signer]:
    """Build a signer from the environment.

    Prefers a hex private key (``QORE_OPERATOR_PRIVATE_KEY_HEX``) over a mnemonic
    (``QORE_MNEMONIC``). Returns ``None`` when neither is set, so callers can give
    a friendly message.
    """
    env = os.environ if env is None else env
    hex_key = env.get("QORE_OPERATOR_PRIVATE_KEY_HEX")
    mnemonic = env.get("QORE_MNEMONIC")
    if hex_key and hex_key.strip():
        return signer_from_private_key(hex_key.strip(), prefix)
    if mnemonic and mnemonic.strip():
        account = derive_native_account(mnemonic.strip(), prefix=prefix)
        return Signer(account.private_key, prefix)
    return None


__all__ = [
    "COSMOS_HD_PATH",
    "NativeAccount",
    "Signer",
    "generate_mnemonic",
    "validate_mnemonic",
    "derive_native_account",
    "signer_from_private_key",
    "signer_from_env",
]
