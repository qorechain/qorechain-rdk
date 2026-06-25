"""Typed, snake_case views of the ``rdk`` query responses, with mappers.

Cosmos REST encodes 64-bit integers as strings; amounts that can be large
(stakes) are kept as strings, while small bounded counters are parsed to ints.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

RawRecord = dict[str, Any]


def _pick(obj: RawRecord, *keys: str) -> Any:
    for key in keys:
        if obj.get(key) is not None:
            return obj[key]
    return None


def _str(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value)


def _num(value: Any, fallback: int = 0) -> int:
    if value is None or value == "":
        return fallback
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


@dataclass
class ParamsView:
    """Module parameters."""

    max_rollups: int
    min_stake_for_rollup: str
    rollup_creation_burn_rate: str
    default_challenge_window: int
    max_da_blob_size: int
    blob_retention_blocks: int
    max_batches_per_block: int


@dataclass
class RollupView:
    """A rollup's configuration and status."""

    rollup_id: str
    creator: str
    profile: str
    settlement_mode: str
    da_backend: str
    block_time_ms: int
    max_tx_per_block: int
    vm_type: str
    status: str
    stake_amount: str
    layer_id: str
    created_height: int


@dataclass
class BatchView:
    """A settlement batch."""

    rollup_id: str
    batch_index: int
    state_root: str
    prev_state_root: str
    tx_count: int
    data_hash: str
    proof_type: str
    status: str
    submitted_at: int
    finalized_at: int
    withdrawals_root: str


def map_params_view(raw: RawRecord) -> ParamsView:
    return ParamsView(
        max_rollups=_num(_pick(raw, "max_rollups", "maxRollups")),
        min_stake_for_rollup=_str(_pick(raw, "min_stake_for_rollup", "minStakeForRollup"), "0"),
        rollup_creation_burn_rate=_str(
            _pick(raw, "rollup_creation_burn_rate", "rollupCreationBurnRate"), "0"
        ),
        default_challenge_window=_num(
            _pick(raw, "default_challenge_window", "defaultChallengeWindow")
        ),
        max_da_blob_size=_num(_pick(raw, "max_da_blob_size", "maxDaBlobSize")),
        blob_retention_blocks=_num(_pick(raw, "blob_retention_blocks", "blobRetentionBlocks")),
        max_batches_per_block=_num(_pick(raw, "max_batches_per_block", "maxBatchesPerBlock")),
    )


def map_rollup_view(raw: RawRecord) -> RollupView:
    return RollupView(
        rollup_id=_str(_pick(raw, "rollup_id", "rollupId")),
        creator=_str(_pick(raw, "creator")),
        profile=_str(_pick(raw, "profile")),
        settlement_mode=_str(_pick(raw, "settlement_mode", "settlementMode")),
        da_backend=_str(_pick(raw, "da_backend", "daBackend")),
        block_time_ms=_num(_pick(raw, "block_time_ms", "blockTimeMs")),
        max_tx_per_block=_num(_pick(raw, "max_tx_per_block", "maxTxPerBlock")),
        vm_type=_str(_pick(raw, "vm_type", "vmType")),
        status=_str(_pick(raw, "status")),
        stake_amount=_str(_pick(raw, "stake_amount", "stakeAmount"), "0"),
        layer_id=_str(_pick(raw, "layer_id", "layerId")),
        created_height=_num(_pick(raw, "created_height", "createdHeight")),
    )


def map_batch_view(raw: RawRecord) -> BatchView:
    return BatchView(
        rollup_id=_str(_pick(raw, "rollup_id", "rollupId")),
        batch_index=_num(_pick(raw, "batch_index", "batchIndex")),
        state_root=_str(_pick(raw, "state_root", "stateRoot")),
        prev_state_root=_str(_pick(raw, "prev_state_root", "prevStateRoot")),
        tx_count=_num(_pick(raw, "tx_count", "txCount")),
        data_hash=_str(_pick(raw, "data_hash", "dataHash")),
        proof_type=_str(_pick(raw, "proof_type", "proofType")),
        status=_str(_pick(raw, "status")),
        submitted_at=_num(_pick(raw, "submitted_at", "submittedAt")),
        finalized_at=_num(_pick(raw, "finalized_at", "finalizedAt")),
        withdrawals_root=_str(_pick(raw, "withdrawals_root", "withdrawalsRoot")),
    )


__all__ = [
    "RawRecord",
    "ParamsView",
    "RollupView",
    "BatchView",
    "map_params_view",
    "map_rollup_view",
    "map_batch_view",
]
