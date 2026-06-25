"""Placeholder client surface for the Python RDK.

The implementation is not shipped yet. The enums and constants in this package
are stable and usable today; the client below raises until the lifecycle, batch,
data-availability, and read clients are filled in following the TypeScript
reference implementation.
"""

from __future__ import annotations

from typing import Any, NoReturn


def create_rdk_client(*args: Any, **kwargs: Any) -> NoReturn:
    """Construct an RDK client. Not implemented yet.

    Raises:
        NotImplementedError: always, until the Python RDK is released.
    """

    raise NotImplementedError("The Python RDK is coming soon.")


__all__ = ["create_rdk_client"]
