"""Rollup creation-cost economics. Pure integer math -- no floating point."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Union

from ..constants import DEFAULT_RDK_PARAMS

_INT_RE = re.compile(r"^\d+$")
_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")

_DEFAULT_BURN_RATE = str(DEFAULT_RDK_PARAMS["rollup_creation_burn_rate"])


def _to_int(value: Union[str, int], label: str) -> int:
    if isinstance(value, bool):  # pragma: no cover - defensive
        raise ValueError(f"{label} must be an integer, not bool")
    if isinstance(value, int):
        return value
    t = str(value).strip()
    if not _INT_RE.match(t):
        raise ValueError(
            f'{label} must be a non-negative integer string, got "{value}"'
        )
    return int(t)


def mul_decimal_floor(amount: int, decimal: str) -> int:
    """Multiply an integer by a non-negative decimal (e.g. ``"0.01"``), flooring.

    Pure integer math -- no floating point -- so the result is exact.
    """
    d = decimal.strip()
    if not _DECIMAL_RE.match(d):
        raise ValueError(f'invalid decimal: "{decimal}"')
    whole, _, frac = d.partition(".")
    scale = 10 ** len(frac)
    numerator = int(f"{whole}{frac}" or "0")
    return (amount * numerator) // scale


@dataclass
class CreationCost:
    """The cost breakdown of creating a rollup. All amounts are uqor strings."""

    #: The stake you commit, in uqor.
    stake_uqor: str
    #: The amount burned on creation, in uqor.
    burn_uqor: str
    #: The stake remaining after the burn, in uqor.
    net_stake_uqor: str
    #: The total leaving your wallet (equal to the committed stake), in uqor.
    total_required_uqor: str
    #: The burn rate applied, as a decimal string.
    burn_rate: str


def estimate_creation_cost(
    stake_uqor: Union[str, int], burn_rate: Optional[str] = None
) -> CreationCost:
    """Estimate the cost of creating a rollup.

    Defaults to the documented burn rate; pass the live
    ``rollup_creation_burn_rate`` from ``rdk.params()`` for an exact figure.
    """
    stake = _to_int(stake_uqor, "stake_uqor")
    rate = burn_rate if burn_rate is not None else _DEFAULT_BURN_RATE
    burn = mul_decimal_floor(stake, rate)
    return CreationCost(
        stake_uqor=str(stake),
        burn_uqor=str(burn),
        net_stake_uqor=str(stake - burn),
        total_required_uqor=str(stake),
        burn_rate=rate,
    )


__all__ = ["mul_decimal_floor", "CreationCost", "estimate_creation_cost"]
