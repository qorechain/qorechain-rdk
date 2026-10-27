"""Typed, snake_case views of the ``rdk`` query responses, with mappers.

Cosmos REST encodes 64-bit integers as strings; amounts that can be large
(stakes) are kept as strings, while small bounded counters are parsed to ints.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from ..utils.bytes import bytes_to_hex, decode_wire_bytes

RawRecord = dict[str, Any]


def _pick(obj: RawRecord, *keys: str) -> Any:
    for key in keys:
        if obj.get(key) is not None:
            return obj[key]
    return None


def _hex_bytes(value: Any) -> str:
    """Normalize a wire bytes field (base64 or hex) to a lowercase hex string."""
    s = _str(value)
    return "" if s == "" else bytes_to_hex(decode_wire_bytes(s))


def _str(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value)


def _optional_num(value: Any) -> Optional[int]:
    """``None`` when the node did not send the field, else the integer."""
    if value is None or value == "":
        return None
    return _num(value)


def _optional_str(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
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
    #: What the rollup still holds in the pooled module escrow, in uqor (chain
    #: v3.2.3+). ``"0"`` from an older node.
    escrow_balance: str = "0"
    #: The rollup's own challenge window in seconds (chain v3.2.4+). ``None``
    #: from a node that does not expose it -- the window is per rollup, so the
    #: global ``default_challenge_window`` param is only a fallback.
    challenge_window_sec: Optional[int] = None
    #: The rollup's challenge bond in uqor (chain v3.2.4+).
    challenge_bond: Optional[str] = None
    #: The rollup's proof system, e.g. ``"fraud"`` (chain v3.2.4+).
    proof_system: Optional[str] = None
    #: Whether the rollup has a ZK verification key registered. No release
    #: before the planned chain v3.2.7 can register one, so ``None`` (field not
    #: served) means none: every zk batch is then refused.
    has_verification_key: Optional[bool] = None


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
    #: The **block height** the batch was submitted at -- not a timestamp.
    #: Releases before 0.6.0 treated it as one, which broke every challenge
    #: deadline the health monitor computed.
    submitted_at: int
    finalized_at: int
    withdrawals_root: str
    #: The submission block's time (Unix seconds) for a batch under the chain's
    #: time-based challenge window (v3.2.4). ``0`` for every earlier batch,
    #: which keeps the block-count window.
    submitted_time: int = 0
    #: Whether the chain judges this batch by the v2 transition binding (chain
    #: v3.2.5, ``rdk-withdrawals-binding``). ``True`` only when the node serves
    #: the field as true; :func:`transition_root_version_for_batch` otherwise
    #: decides by height.
    withdrawals_bound: bool = False


@dataclass
class AnchorView:
    """A subsidiary-layer state anchor committed to the Main Chain.

    The ``x/multilayer`` ``StateAnchorView``. Byte fields are normalized to
    lowercase hex. The PQC (Dilithium-5) signature covers the canonical message
    ``layer_id || layer_height(8B BE) || state_root || validator_set_hash``,
    signed by the layer creator's registered post-quantum key.
    """

    layer_id: str
    layer_height: int
    state_root: str
    validator_set_hash: str
    main_chain_height: int
    anchored_at: int
    pqc_signature: str
    transaction_count: int
    compressed_state_proof: str


@dataclass
class PqcAccountView:
    """A post-quantum account view (the ``x/pqc`` ``PQCAccountView``)."""

    address: str
    public_key: str
    algorithm_id: int
    algorithm_name: str
    ecdsa_pubkey: str


def map_anchor_view(raw: RawRecord) -> AnchorView:
    return AnchorView(
        layer_id=_str(_pick(raw, "layer_id", "layerId")),
        layer_height=_num(_pick(raw, "layer_height", "layerHeight")),
        state_root=_hex_bytes(_pick(raw, "state_root", "stateRoot")),
        validator_set_hash=_hex_bytes(_pick(raw, "validator_set_hash", "validatorSetHash")),
        main_chain_height=_num(_pick(raw, "main_chain_height", "mainChainHeight")),
        anchored_at=_num(_pick(raw, "anchored_at", "anchoredAt")),
        pqc_signature=_hex_bytes(
            _pick(raw, "pqc_aggregate_signature", "pqcAggregateSignature")
        ),
        transaction_count=_num(_pick(raw, "transaction_count", "transactionCount")),
        compressed_state_proof=_hex_bytes(
            _pick(raw, "compressed_state_proof", "compressedStateProof")
        ),
    )


def map_pqc_account_view(raw: RawRecord) -> PqcAccountView:
    return PqcAccountView(
        address=_str(_pick(raw, "address")),
        public_key=_hex_bytes(_pick(raw, "public_key", "publicKey")),
        algorithm_id=_num(_pick(raw, "algorithm_id", "algorithmId")),
        algorithm_name=_str(_pick(raw, "algorithm_name", "algorithmName")),
        ecdsa_pubkey=_hex_bytes(_pick(raw, "ecdsa_pubkey", "ecdsaPubkey")),
    )


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
        escrow_balance=_str(_pick(raw, "escrow_balance", "escrowBalance"), "0"),
        challenge_window_sec=_optional_num(_pick(raw, "challenge_window_sec", "challengeWindowSec")),
        challenge_bond=_optional_str(_pick(raw, "challenge_bond", "challengeBond")),
        proof_system=_optional_str(_pick(raw, "proof_system", "proofSystem")),
        has_verification_key=(
            True if _pick(raw, "has_verification_key", "hasVerificationKey") is True else None
        ),
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
        submitted_time=_num(_pick(raw, "submitted_time", "submittedTime")),
        withdrawals_bound=_pick(raw, "withdrawals_bound", "withdrawalsBound") is True,
    )


__all__ = [
    "RawRecord",
    "ParamsView",
    "RollupView",
    "BatchView",
    "AnchorView",
    "PqcAccountView",
    "map_params_view",
    "map_rollup_view",
    "map_batch_view",
    "map_anchor_view",
    "map_pqc_account_view",
]
