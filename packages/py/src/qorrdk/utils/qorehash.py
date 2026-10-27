"""QoreChain's default hash: SHAKE-256 with a 32-byte output (the chain's
``qorehash.Sum256``). Merkle nodes, withdrawal leaves, DA blob commitments and
transition roots all use it.
"""

from __future__ import annotations

import hashlib
from typing import Union


def qorehash(*parts: Union[bytes, bytearray]) -> bytes:
    """SHAKE-256 of the concatenation of ``parts``, 32 bytes."""
    h = hashlib.shake_256()
    for p in parts:
        h.update(p)
    return h.digest(32)


__all__ = ["qorehash"]
