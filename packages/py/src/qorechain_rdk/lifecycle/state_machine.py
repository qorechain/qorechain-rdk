"""Client-side awareness of the rollup and settlement-batch lifecycles.

Rollup: ``pending -> active -> paused -> stopped`` (creator-only
pause/resume/stop). Batch: ``submitted -> finalized``, with
``submitted -> challenged -> rejected`` (and ``challenged -> finalized`` when a
challenge is dismissed) on the optimistic path.
"""

from __future__ import annotations

from typing import Literal

from ..enums import BatchStatus, RollupStatus

RollupAction = Literal["pause", "resume", "stop"]


def _status(value: object) -> str:
    return getattr(value, "value", value)


#: The statuses from which each rollup action is permitted.
ROLLUP_ACTION_FROM: dict[str, tuple[str, ...]] = {
    "pause": (RollupStatus.ACTIVE.value,),
    "resume": (RollupStatus.PAUSED.value,),
    "stop": (RollupStatus.ACTIVE.value, RollupStatus.PAUSED.value),
}


def can_perform_rollup_action(action: RollupAction, status: RollupStatus) -> bool:
    """Whether a rollup action is allowed from the given status."""
    return _status(status) in ROLLUP_ACTION_FROM[action]


def assert_rollup_action(action: RollupAction, status: RollupStatus) -> None:
    """Raise if a rollup action is not allowed from the given status."""
    if not can_perform_rollup_action(action, status):
        allowed = ", ".join(ROLLUP_ACTION_FROM[action]) or "none"
        raise ValueError(
            f'cannot {action} a rollup in status "{_status(status)}" '
            f"(allowed from: {allowed})"
        )


#: The valid next states for each batch status. Finalized/rejected are terminal.
BATCH_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "submitted": (BatchStatus.FINALIZED.value, BatchStatus.CHALLENGED.value),
    "challenged": (BatchStatus.REJECTED.value, BatchStatus.FINALIZED.value),
    "finalized": (),
    "rejected": (),
}


def is_batch_final(status: BatchStatus) -> bool:
    """Whether a batch status is terminal (finalized or rejected)."""
    return len(BATCH_TRANSITIONS[_status(status)]) == 0


def challenge_window_deadline(submitted_at_secs: int, window_secs: int) -> int:
    """The Unix timestamp at which an optimistic batch's challenge window closes."""
    return submitted_at_secs + window_secs


def is_challenge_window_closed(
    submitted_at_secs: int, window_secs: int, now_secs: int
) -> bool:
    """Whether an optimistic batch's challenge window has elapsed at ``now_secs``."""
    return now_secs >= challenge_window_deadline(submitted_at_secs, window_secs)


__all__ = [
    "RollupAction",
    "ROLLUP_ACTION_FROM",
    "can_perform_rollup_action",
    "assert_rollup_action",
    "BATCH_TRANSITIONS",
    "is_batch_final",
    "challenge_window_deadline",
    "is_challenge_window_closed",
]
