"""bech32 <-> hex address helpers."""

from __future__ import annotations

import bech32

from ..constants import ACCOUNT_PREFIX
from .bytes import bytes_to_hex, hex_to_bytes


def bech32_to_hex(address: str) -> str:
    """Decode a bech32 address to a ``0x``-prefixed hex string of its data bytes."""
    hrp, data = bech32.bech32_decode(address)
    if hrp is None or data is None:
        raise ValueError(f'invalid bech32 address: "{address}"')
    decoded = bech32.convertbits(data, 5, 8, False)
    if decoded is None:
        raise ValueError(f'invalid bech32 address: "{address}"')
    return f"0x{bytes_to_hex(bytes(decoded))}"


def hex_to_bech32(hex_str: str, prefix: str = ACCOUNT_PREFIX) -> str:
    """Encode hex data bytes as a bech32 address with the given prefix."""
    data = hex_to_bytes(hex_str)
    words = bech32.convertbits(list(data), 8, 5, True)
    if words is None:
        raise ValueError(f'cannot encode hex "{hex_str}" as bech32')
    encoded = bech32.bech32_encode(prefix, words)
    return encoded


def bech32_prefix(address: str) -> str:
    """Return the human-readable prefix of a bech32 address."""
    hrp, _ = bech32.bech32_decode(address)
    if hrp is None:
        raise ValueError(f'invalid bech32 address: "{address}"')
    return hrp


__all__ = ["bech32_to_hex", "hex_to_bech32", "bech32_prefix"]
