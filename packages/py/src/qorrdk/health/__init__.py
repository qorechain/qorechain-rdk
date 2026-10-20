"""Rollup health: a consolidated read of a rollup's status, its latest batch, and
(for optimistic rollups) the challenge-window countdown -- assembled from the
existing read surface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..lifecycle.state_machine import ChainTip, ChallengeWindowStatus, batch_challenge_window


@dataclass
class RollupHealth:
    rollup_id: str
    status: str
    has_batches: bool
    healthy: bool
    notes: list[str] = field(default_factory=list)
    latest_batch_index: Optional[int] = None
    latest_batch_status: Optional[str] = None
    #: Height the latest batch was submitted at.
    latest_batch_height: Optional[int] = None
    #: Blocks since the latest batch was submitted.
    batch_age_blocks: Optional[int] = None
    #: Seconds since submission -- only when the node records the submission
    #: time (chain v3.2.4+); a height alone cannot be turned into a time.
    batch_age_secs: Optional[int] = None
    #: The latest pending batch's window, by the chain's own rules.
    challenge_window: Optional[ChallengeWindowStatus] = None
    #: Time mode only: when the window closes (Unix seconds).
    challenge_deadline_secs: Optional[int] = None
    #: Time mode only: seconds until it closes (negative once past).
    seconds_until_challenge_deadline: Optional[int] = None


def get_rollup_health(
    client,
    rollup_id: str,
    now_secs: Optional[int] = None,
    tip: Optional[ChainTip] = None,
    challenge_window_secs: Optional[int] = None,
) -> RollupHealth:
    """Assemble a :class:`RollupHealth` snapshot for a rollup.

    ``tip`` defaults to the node's ``/status``; ``now_secs`` from earlier
    releases is still honoured as the tip time but cannot supply a height.
    ``challenge_window_secs`` defaults to the rollup's own window as the node
    reports it (chain v3.2.4+), then to the global param.
    """
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
    health.latest_batch_height = latest.submitted_at

    if latest.status == "rejected":
        healthy = False
        notes.append("latest batch was rejected")

    if tip is None:
        try:
            tip = client.get_chain_tip()
        except Exception as err:  # noqa: BLE001
            notes.append(f"could not read the chain tip: {err}")
    if tip is not None and now_secs is not None:
        tip = ChainTip(height=tip.height, time_secs=now_secs)
    if tip is not None:
        health.batch_age_blocks = tip.height - latest.submitted_at
        if latest.submitted_time > 0:
            health.batch_age_secs = tip.time_secs - latest.submitted_time

    if latest.status in ("submitted", "challenged"):
        window_secs = challenge_window_secs
        if window_secs is None:
            window_secs = rollup.challenge_window_sec
        if window_secs is None:
            window_secs = client.params().default_challenge_window
        if tip is not None:
            window = batch_challenge_window(
                latest.submitted_at, latest.submitted_time, window_secs, tip
            )
            health.challenge_window = window
            if window.mode == "time":
                health.challenge_deadline_secs = window.deadline_secs
                health.seconds_until_challenge_deadline = window.seconds_remaining
        if rollup.challenge_window_sec is None and challenge_window_secs is None:
            notes.append(
                "this node does not report the rollup's own challenge window; using the "
                "global default, which is wrong for a rollup that set its own"
            )
        if latest.status == "challenged":
            notes.append("latest batch is under challenge")

    health.healthy = healthy
    return health


__all__ = ["RollupHealth", "get_rollup_health"]
