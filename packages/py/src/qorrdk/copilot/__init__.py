"""QCAI Rollup Copilot.

A read-only advisor that aggregates the network's QCAI/RL advisory surfaces into
a single, actionable view for one rollup.

Everything here is advisory and best-effort: each underlying read is wrapped so
an unavailable advisory service degrades to a warning rather than failing the
whole call. Always review suggestions before acting on them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Optional, TypeVar

from ..client.views import RawRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..client.rdk_client import RdkClient

T = TypeVar("T")


@dataclass
class CopilotSuggestion:
    """A single plain-language suggestion with a severity."""

    #: One of ``info`` | ``warn`` | ``action``.
    level: str
    message: str


@dataclass
class RollupAdvice:
    """Aggregated advice for a rollup."""

    rollup_id: str
    #: The rollup's current status (``active``, ``paused``, ...) if it could be read.
    status: str
    #: Open fraud investigations that reference this rollup.
    fraud_investigations: list[RawRecord]
    #: Plain-language, reviewable suggestions derived from the surfaces below.
    suggestions: list[CopilotSuggestion]
    #: Advisory surfaces that could not be reached this call.
    warnings: list[str]
    #: QCAI fee estimate (raw advisory payload), if available.
    fee_estimate: Optional[RawRecord] = None
    #: QCAI network recommendations, if available.
    network_recommendations: Optional[RawRecord] = None
    #: QCAI RL agent status, if available.
    rl_agent_status: Optional[RawRecord] = None


def _attempt(warnings: list[str], label: str, fn: Callable[[], T]) -> Optional[T]:
    try:
        return fn()
    except Exception as err:  # noqa: BLE001 - advisory surfaces degrade gracefully
        warnings.append(f"{label}: {err}")
        return None


def _mentions(record: object, needle: str) -> bool:
    """Lower-cased JSON of a record, for substring matching across unknown shapes."""
    try:
        return needle.lower() in json.dumps(record).lower()
    except (TypeError, ValueError):
        return False


def get_rollup_advice(client: "RdkClient", rollup_id: str) -> RollupAdvice:
    """Gather advice for a rollup from the QCAI fee/network/fraud surfaces and the RL agent.

    Best-effort: unreachable surfaces are reported in ``warnings`` and omitted,
    never raised.
    """
    warnings: list[str] = []
    suggestions: list[CopilotSuggestion] = []

    rollup = _attempt(warnings, "rollup", lambda: client.rest.get_rollup(rollup_id))
    urgency = _attempt(warnings, "fee-estimate", lambda: client.rest.get_fee_estimate())
    net_recs = _attempt(
        warnings, "network-recommendations", lambda: client.rest.get_network_recommendations()
    )
    all_fraud = _attempt(
        warnings, "fraud-investigations", lambda: client.rest.get_fraud_investigations()
    )
    rl_status = _attempt(
        warnings, "rl-agent-status", lambda: client.qor.get_rl_agent_status()
    )

    fraud_investigations = [f for f in (all_fraud or []) if _mentions(f, rollup_id)]

    # Derive reviewable, plain-language suggestions.
    if rollup is not None and rollup.status and rollup.status != "active":
        suggestions.append(
            CopilotSuggestion(
                level="warn",
                message=(
                    f'Rollup status is "{rollup.status}" -- operator action may be '
                    "required before it settles batches."
                ),
            )
        )
    if fraud_investigations:
        suggestions.append(
            CopilotSuggestion(
                level="action",
                message=(
                    f"{len(fraud_investigations)} open fraud investigation(s) reference "
                    "this rollup -- review batch validity before the challenge window closes."
                ),
            )
        )
    if urgency:
        suggestions.append(
            CopilotSuggestion(
                level="info",
                message=(
                    "A live QCAI fee estimate is available -- prefer it over a static "
                    "gas price for batch submission."
                ),
            )
        )
    if net_recs and _mentions(net_recs, "congest"):
        suggestions.append(
            CopilotSuggestion(
                level="warn",
                message=(
                    "QCAI reports network congestion -- consider raising the fee or "
                    "deferring non-urgent batches."
                ),
            )
        )
    if not suggestions:
        suggestions.append(
            CopilotSuggestion(
                level="info", message="No issues flagged by the QCAI advisory surfaces."
            )
        )

    return RollupAdvice(
        rollup_id=rollup_id,
        status=rollup.status if rollup is not None else "unknown",
        fee_estimate=urgency,
        network_recommendations=net_recs,
        fraud_investigations=fraud_investigations,
        rl_agent_status=rl_status,
        suggestions=suggestions,
        warnings=warnings,
    )


__all__ = [
    "CopilotSuggestion",
    "RollupAdvice",
    "get_rollup_advice",
]
