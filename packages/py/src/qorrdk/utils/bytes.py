"""Byte/hex helpers used across the tx, DA, and event layers."""

from __future__ import annotations

import base64
import re
from typing import Union

_HEX_RE = re.compile(r"^[0-9a-fA-F]*$")
_HEX_FULL_RE = re.compile(r"^[0-9a-fA-F]+$")
_BASE64_HINT_RE = re.compile(r"[+/=]|[g-zG-Z]")


def bytes_to_hex(data: bytes) -> str:
    """Convert bytes to a lowercase hex string (no ``0x`` prefix)."""
    return data.hex()


def hex_to_bytes(hex_str: str) -> bytes:
    """Parse a hex string (with or without a ``0x`` prefix) into bytes."""
    h = hex_str[2:] if hex_str[:2] in ("0x", "0X") else hex_str
    if len(h) % 2 != 0 or not _HEX_RE.match(h):
        raise ValueError(f'invalid hex string: "{hex_str}"')
    return bytes.fromhex(h)


def to_bytes(value: Union[str, bytes, bytearray]) -> bytes:
    """Coerce a hex string or byte sequence into bytes."""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    return hex_to_bytes(value)


def base64_to_bytes(b64: str) -> bytes:
    """Decode a standard (RFC 4648) base64 string into bytes."""
    if b64 == "":
        return b""
    return base64.b64decode(b64)


def bytes_to_base64(data: bytes) -> str:
    """Encode bytes as a standard (RFC 4648) base64 string."""
    return base64.b64encode(data).decode("ascii")


def decode_wire_bytes(value: str) -> bytes:
    """Decode a bytes value as it arrives from the chain's wire surface.

    Cosmos gRPC-gateway (jsonpb) encodes proto ``bytes`` as base64; some
    surfaces send hex. Disambiguated by alphabet and length (a 32-byte root is
    64 hex chars vs ~44 base64 chars with ``+/=``), so both encodings
    round-trip correctly.
    """
    if value == "":
        return b""
    is_hex = len(value) % 2 == 0 and bool(_HEX_FULL_RE.match(value))
    looks_base64 = bool(_BASE64_HINT_RE.search(value))
    if is_hex and not looks_base64:
        return hex_to_bytes(value)
    return base64_to_bytes(value)


__all__ = [
    "bytes_to_hex",
    "hex_to_bytes",
    "to_bytes",
    "base64_to_bytes",
    "bytes_to_base64",
    "decode_wire_bytes",
]
