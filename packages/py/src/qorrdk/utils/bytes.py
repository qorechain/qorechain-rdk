"""Byte/hex helpers used across the tx, DA, and event layers."""

from __future__ import annotations

import re
from typing import Union

_HEX_RE = re.compile(r"^[0-9a-fA-F]*$")


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


__all__ = ["bytes_to_hex", "hex_to_bytes", "to_bytes"]
