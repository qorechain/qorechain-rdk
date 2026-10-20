"""Client-side awareness of the rollup and settlement-batch lifecycles.

Rollup: ``pending -> active -> paused -> stopped`` (creator-only
pause/resume/stop). Batch: ``submitted -> finalized``, with
``submitted -> challenged -> rejected`` (and ``challenged -> finalized`` when a
challenge is dismissed) on the optimistic path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

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
    "ChainTip",
    "ChallengeWindowStatus",
    "batch_challenge_window",
    "RollupAction",
    "ROLLUP_ACTION_FROM",
    "can_perform_rollup_action",
    "assert_rollup_action",
    "BATCH_TRANSITIONS",
    "is_batch_final",
    "challenge_window_deadline",
    "is_challenge_window_closed",
]


@dataclass
class ChainTip:
    """The chain tip a challenge window is judged against."""

    height: int
    #: Block time of the tip, Unix seconds.
    time_secs: int


@dataclass
class ChallengeWindowStatus:
    """A batch's challenge window, computed with the chain's own rules.

    The chain chooses the rule **per batch**. A batch submitted under the
    time-based window (chain v3.2.4, ``rdk-challenge-window-time``) records its
    submission block time, and its window closes once block time reaches
    ``submitted_time + window_secs`` (``mode == "time"``). Every earlier batch
    keeps the original rule, ``window_secs // 6`` blocks counted from the
    submission **height** (``mode == "blocks"``) -- which assumed 6-second
    blocks, so a 7-day window closes after about 3.75 days on mainnet and 28
    hours on the testnet.

    On the block-count path the chain refuses a challenge once
    ``height - submitted_at > window_blocks`` but finalizes once it is ``>=``,
    so for exactly one block a batch is both finalizable and still
    challengeable; ``open`` and ``finalizable`` report the two separately.
    """

    mode: str
    open: bool
    finalizable: bool
    deadline_secs: Optional[int] = None
    seconds_remaining: Optional[int] = None
    window_blocks: Optional[int] = None
    deadline_height: Optional[int] = None
    blocks_remaining: Optional[int] = None


def batch_challenge_window(
    submitted_at: int, submitted_time: int, window_secs: int, tip: ChainTip
) -> ChallengeWindowStatus:
    """Compute a batch's challenge window exactly as the chain does.

    ``submitted_at`` is the submission **height**; ``submitted_time`` is the
    submission block time, or ``0`` for a batch under the block-count rule.
    ``window_secs`` is the **rollup's own** window -- the global
    ``default_challenge_window`` param is only a fallback.
    """
    if submitted_time > 0:
        elapsed = tip.time_secs - submitted_time
        # The chain treats a negative elapsed (tip before submission) as not elapsed.
        elapsed_fully = elapsed >= 0 and elapsed >= window_secs
        deadline = submitted_time + window_secs
        return ChallengeWindowStatus(
            mode="time",
            open=not elapsed_fully,
            finalizable=elapsed_fully,
            deadline_secs=deadline,
            seconds_remaining=deadline - tip.time_secs,
        )
    window_blocks = window_secs // 6
    since = tip.height - submitted_at
    deadline_height = submitted_at + window_blocks
    return ChallengeWindowStatus(
        mode="blocks",
        open=since <= window_blocks,
        finalizable=since >= window_blocks,
        window_blocks=window_blocks,
        deadline_height=deadline_height,
        blocks_remaining=deadline_height - tip.height,
    )
