"""Typed, snake_case views of the ``rdk`` query responses, with mappers.

Cosmos REST encodes 64-bit integers as strings; amounts that can be large
(stakes) are kept as strings, while small bounded counters are parsed to ints.
"""

from __future__ import annotations

from dataclasses import dataclass, field
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


def _str_list(value: Any) -> list:
    return [str(v) for v in value] if isinstance(value, list) else []


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
    #: Chain v3.2.8+ (effective values; ``None`` from an older node).
    finalized_batch_retention_blocks: Optional[int] = None
    max_posted_data_bytes: Optional[int] = None
    max_posted_data_bytes_per_block: Optional[int] = None
    posted_data_fee_per_byte: Optional[int] = None
    posted_data_retention_blocks: Optional[int] = None
    #: Bond a qledger-v1 batch submitter must hold, in uqor (v3.2.8+).
    min_submitter_bond: Optional[str] = None


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
    #: Whether the rollup has a ZK verification key registered (chain v3.2.7+,
    #: ``MsgSetVerificationKey``). ``None`` (field not served) means none: every
    #: zk batch is then refused.
    has_verification_key: Optional[bool] = None
    #: Chain v3.2.8+: ``"based"`` or ``""`` (the rollup's sequencer settles).
    sequencing: str = ""
    #: Chain v3.2.8+: ``"qledger-v1"`` or ``""``.
    execution_vm: str = ""
    #: Chain v3.2.8+: ``"encapsulated"`` or ``""``.
    privacy: str = ""
    #: Chain v3.2.8+: a private rollup's members, in envelope order.
    members: list = field(default_factory=list)  # list[str]
    #: Chain v3.2.8+: the membership epoch an envelope must carry.
    members_epoch: int = 0
    #: Chain v3.2.8+: uqor deposited into a qledger-v1 rollup and not withdrawn.
    deposit_pool: str = "0"


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
    #: Chain v3.2.8+, based rollups: the inbox range the batch consumed (after
    #: ``inbox_start``, up to ``inbox_end``).
    inbox_start: int = 0
    inbox_end: int = 0
    #: Chain v3.2.8+: the stored ``withdrawals_root`` is the submitted root
    #: reduced modulo the BLS12-381 scalar field (a Groth16 batch that binds
    #: its withdrawals, settled with ``rdk-zk-canonical-inputs`` on). Compare a
    #: tree root with it modulo r (:func:`~qorrdk.zk.withdrawals_root_matches`),
    #: not byte for byte.
    withdrawals_root_reduced: bool = False


@dataclass
class InboxView:
    """A rollup's inbox (chain v3.2.8+). Hex fields are as the node serves them."""

    rollup_id: str
    sequencing: str
    #: Sequence of the last post (0 = none yet).
    head_sequence: int
    head_acc: str
    #: Where the next based batch starts.
    consumed_sequence: int
    consumed_acc: str
    #: The range end ``range_data_hash`` is for.
    range_end: int
    #: The ``data_hash`` a based batch with ``inbox_end = range_end`` must
    #: carry; empty when no longer retained.
    range_data_hash: str


@dataclass
class PostedDataView:
    """One posted-data commitment (chain v3.2.8+)."""

    rollup_id: str
    sequence: int
    #: SHA-256 of the payload, as the node serves it.
    data_hash: str
    size: int
    poster: str
    #: The block whose transaction carries the payload.
    height: int
    inbox_acc: str
    expires_at_height: int


@dataclass
class SubmitterBondView:
    """A submitter's bond on a qledger-v1 rollup (chain v3.2.8+)."""

    #: uqor; ``"0"`` when there is none.
    amount: str
    last_submit_time: int
    #: Block time (Unix seconds) from which an unbond succeeds.
    unbond_after: int
    #: The submitter's batches on the rollup still waiting for finality
    #: (chain v3.2.8+; at most 1,024).
    pending: int = 0


@dataclass
class KemKeyView:
    """A key-encapsulation key an address published (``x/pqc``, chain v3.2.5+)."""

    address: str
    algorithm_id: int
    algorithm_name: str
    #: The FIPS 203 encapsulation key, lowercase hex.
    public_key: str
    registered_height: int


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
        finalized_batch_retention_blocks=_optional_num(
            _pick(raw, "finalized_batch_retention_blocks", "finalizedBatchRetentionBlocks")
        ),
        max_posted_data_bytes=_optional_num(
            _pick(raw, "max_posted_data_bytes", "maxPostedDataBytes")
        ),
        max_posted_data_bytes_per_block=_optional_num(
            _pick(raw, "max_posted_data_bytes_per_block", "maxPostedDataBytesPerBlock")
        ),
        posted_data_fee_per_byte=_optional_num(
            _pick(raw, "posted_data_fee_per_byte", "postedDataFeePerByte")
        ),
        posted_data_retention_blocks=_optional_num(
            _pick(raw, "posted_data_retention_blocks", "postedDataRetentionBlocks")
        ),
        min_submitter_bond=_optional_str(_pick(raw, "min_submitter_bond", "minSubmitterBond")),
    )


def map_inbox_view(raw: RawRecord) -> InboxView:
    return InboxView(
        rollup_id=_str(_pick(raw, "rollup_id", "rollupId")),
        sequencing=_str(_pick(raw, "sequencing")),
        head_sequence=_num(_pick(raw, "head_sequence", "headSequence")),
        head_acc=_str(_pick(raw, "head_acc", "headAcc")),
        consumed_sequence=_num(_pick(raw, "consumed_sequence", "consumedSequence")),
        consumed_acc=_str(_pick(raw, "consumed_acc", "consumedAcc")),
        range_end=_num(_pick(raw, "range_end", "rangeEnd")),
        range_data_hash=_str(_pick(raw, "range_data_hash", "rangeDataHash")),
    )


def map_posted_data_view(raw: RawRecord) -> PostedDataView:
    return PostedDataView(
        rollup_id=_str(_pick(raw, "rollup_id", "rollupId")),
        sequence=_num(_pick(raw, "sequence")),
        data_hash=_str(_pick(raw, "data_hash", "dataHash")),
        size=_num(_pick(raw, "size")),
        poster=_str(_pick(raw, "poster")),
        height=_num(_pick(raw, "height")),
        inbox_acc=_str(_pick(raw, "inbox_acc", "inboxAcc")),
        expires_at_height=_num(_pick(raw, "expires_at_height", "expiresAtHeight")),
    )


def map_submitter_bond_view(raw: RawRecord) -> SubmitterBondView:
    return SubmitterBondView(
        amount=_str(_pick(raw, "amount"), "0"),
        last_submit_time=_num(_pick(raw, "last_submit_time", "lastSubmitTime")),
        unbond_after=_num(_pick(raw, "unbond_after", "unbondAfter")),
        pending=_num(_pick(raw, "pending")),
    )


def map_kem_key_view(raw: RawRecord) -> KemKeyView:
    return KemKeyView(
        address=_str(_pick(raw, "address")),
        algorithm_id=_num(_pick(raw, "algorithm_id", "algorithmId")),
        algorithm_name=_str(_pick(raw, "algorithm_name", "algorithmName")),
        public_key=_hex_bytes(_pick(raw, "public_key", "publicKey")),
        registered_height=_num(_pick(raw, "registered_height", "registeredHeight")),
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
        sequencing=_str(_pick(raw, "sequencing")),
        execution_vm=_str(_pick(raw, "execution_vm", "executionVm")),
        privacy=_str(_pick(raw, "privacy")),
        members=_str_list(_pick(raw, "members")),
        members_epoch=_num(_pick(raw, "members_epoch", "membersEpoch")),
        deposit_pool=_str(_pick(raw, "deposit_pool", "depositPool"), "0"),
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
        inbox_start=_num(_pick(raw, "inbox_start", "inboxStart")),
        inbox_end=_num(_pick(raw, "inbox_end", "inboxEnd")),
        withdrawals_root_reduced=(
            _pick(raw, "withdrawals_root_reduced", "withdrawalsRootReduced") is True
        ),
    )


__all__ = [
    "RawRecord",
    "ParamsView",
    "RollupView",
    "BatchView",
    "AnchorView",
    "PqcAccountView",
    "InboxView",
    "PostedDataView",
    "SubmitterBondView",
    "KemKeyView",
    "map_inbox_view",
    "map_posted_data_view",
    "map_submitter_bond_view",
    "map_kem_key_view",
    "map_params_view",
    "map_rollup_view",
    "map_batch_view",
    "map_anchor_view",
    "map_pqc_account_view",
]
