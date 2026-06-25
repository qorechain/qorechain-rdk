"""Rollup health: a consolidated read of a rollup's status, its latest batch, and
(for optimistic rollups) the challenge-window countdown -- assembled from the
existing read surface.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RollupHealth:
    rollup_id: str
    status: str
    has_batches: bool
    healthy: bool
    notes: list[str] = field(default_factory=list)
    latest_batch_index: Optional[int] = None
    latest_batch_status: Optional[str] = None
    batch_age_secs: Optional[int] = None
    challenge_deadline_secs: Optional[int] = None
    seconds_until_challenge_deadline: Optional[int] = None


def get_rollup_health(
    client, rollup_id: str, now_secs: Optional[int] = None
) -> RollupHealth:
    """Assemble a :class:`RollupHealth` snapshot for a rollup."""
    now_secs = int(time.time()) if now_secs is None else now_secs
    notes: list[str] = []

    rollup = client.rest.get_rollup(rollup_id)
    healthy = rollup.status == "active"
    if rollup.status != "active":
        notes.append(f'rollup status is "{rollup.status}"')

    health = RollupHealth(
        rollup_id=rollup_id,
        status=rollup.status,
        has_batches=False,
        healthy=healthy,
        notes=notes,
    )

    try:
        latest = client.rest.get_latest_batch(rollup_id)
    except Exception:  # noqa: BLE001
        notes.append("no settlement batches submitted yet")
        return health

    if latest is None or latest.submitted_at == 0:
        notes.append("no settlement batches submitted yet")
        return health

    health.has_batches = True
    health.latest_batch_index = latest.batch_index
    health.latest_batch_status = latest.status
    health.batch_age_secs = now_secs - latest.submitted_at

    if latest.status == "rejected":
        healthy = False
        notes.append("latest batch was rejected")

    if latest.status in ("submitted", "challenged"):
        params = client.params()
        deadline = latest.submitted_at + params.default_challenge_window
        health.challenge_deadline_secs = deadline
        health.seconds_until_challenge_deadline = deadline - now_secs
        if latest.status == "challenged":
            notes.append("latest batch is under challenge")

    health.healthy = healthy
    return health


__all__ = ["RollupHealth", "get_rollup_health"]
