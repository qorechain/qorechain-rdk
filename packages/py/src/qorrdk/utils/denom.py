"""Exact denomination conversion between display (QOR) and base (uqor) units.

All math is integer/string based -- never floating point -- so values are exact.
"""

from __future__ import annotations

import re
from typing import Union

from ..constants import DENOM_EXPONENT

_QOR_RE = re.compile(r"^\d+(\.\d+)?$")
_UQOR_RE = re.compile(r"^\d+$")


def qor_to_uqor(
    amount: Union[str, int, float], exponent: int = DENOM_EXPONENT
) -> str:
    """Convert a display amount (QOR) to base units (uqor) as an integer string.

    :raises ValueError: if the input is not a non-negative decimal or has more
        than ``exponent`` fractional digits.
    """
    if isinstance(amount, float):
        # Render without scientific notation; trim trailing zeros.
        s = format(amount, "f")
    else:
        s = str(amount).strip()
    if not _QOR_RE.match(s):
        raise ValueError(f'invalid QOR amount: "{amount}"')
    whole, _, frac = s.partition(".")
    if len(frac) > exponent:
        raise ValueError(
            f'QOR amount "{amount}" has more than {exponent} fractional digits'
        )
    combined = f"{whole}{frac.ljust(exponent, '0')}".lstrip("0")
    return combined if combined != "" else "0"


def uqor_to_qor(
    amount: Union[str, int], exponent: int = DENOM_EXPONENT
) -> str:
    """Convert base units (uqor) to a display amount (QOR), trimming trailing zeros.

    :raises ValueError: if a string input is not a non-negative integer.
    """
    if isinstance(amount, bool):  # pragma: no cover - defensive
        raise ValueError("uqor amount must be an integer, not bool")
    if isinstance(amount, int):
        value = amount
    else:
        t = str(amount).strip()
        if not _UQOR_RE.match(t):
            raise ValueError(f'invalid uqor amount: "{amount}"')
        value = int(t)
    if value < 0:
        raise ValueError("uqor amount must be non-negative")
    base = 10**exponent
    whole, frac = divmod(value, base)
    if frac == 0:
        return str(whole)
    frac_str = str(frac).rjust(exponent, "0").rstrip("0")
    return f"{whole}.{frac_str}"


__all__ = ["qor_to_uqor", "uqor_to_qor"]
