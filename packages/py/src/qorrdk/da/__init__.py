"""Native data-availability helpers.

On QoreChain, a settlement batch commits to its data via the batch's
``data_hash``; the native DA backend stores the corresponding blob on-chain. This
module assembles a blob (enforcing the size limit) and computes the ``data_hash``
to put in the batch. Read the live ``max_da_blob_size`` from ``rdk.params()``; the
default here is reference only.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Optional, Union

from ..constants import DEFAULT_RDK_PARAMS
from ..enums import DABackend
from ..utils.bytes import bytes_to_hex, to_bytes

_DEFAULT_MAX_BLOB_SIZE = int(DEFAULT_RDK_PARAMS["max_da_blob_size"])

#: Message shown when a not-yet-active DA backend is selected for live use.
DA_CELESTIA_UNAVAILABLE_MESSAGE = (
    "Celestia data availability is selectable but not yet active on the QoreChain "
    "network. Use the 'native' backend, or wait until Celestia is enabled."
)


@dataclass
class DaBlob:
    """A prepared native DA blob and the commitment to place in a batch."""

    data: bytes
    data_hash: str
    size: int


def build_da_blob(
    data: Union[str, bytes, bytearray], max_blob_size: Optional[int] = None
) -> DaBlob:
    """Assemble a native DA blob from raw data and compute its ``data_hash``.

    :raises ValueError: if the blob exceeds ``max_blob_size`` (defaults to the
        documented limit).
    """
    blob = to_bytes(data)
    limit = _DEFAULT_MAX_BLOB_SIZE if max_blob_size is None else max_blob_size
    if len(blob) > limit:
        raise ValueError(
            f"DA blob is {len(blob)} bytes, exceeding the maximum of {limit} bytes"
        )
    digest = hashlib.sha256(blob).digest()
    return DaBlob(data=blob, data_hash=f"0x{bytes_to_hex(digest)}", size=len(blob))


def is_da_backend_available(da: DABackend) -> bool:
    """Whether a DA backend is currently active on the network."""
    return DABackend(da) == DABackend.NATIVE


def assert_da_backend_available(da: DABackend) -> None:
    """Raise if a DA backend the network does not yet serve is about to be used."""
    if not is_da_backend_available(da):
        raise ValueError(DA_CELESTIA_UNAVAILABLE_MESSAGE)


__all__ = [
    "DA_CELESTIA_UNAVAILABLE_MESSAGE",
    "DaBlob",
    "build_da_blob",
    "is_da_backend_available",
    "assert_da_backend_available",
]
