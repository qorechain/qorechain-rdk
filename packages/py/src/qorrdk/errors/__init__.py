"""Readable decoding of a transaction the ``rdk`` module refused.

The ``rdk`` module's error codes, copied from the chain's error registry, each
with a stable ``kind`` and, for the ones a rollup operator meets, a hint on what
to do about it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

#: The ``rdk`` codespace, code by code, as the chain registers it:
#: ``code -> (kind, message, hint or None)``.
RDK_ERRORS: dict[int, tuple[str, str, Optional[str]]] = {
    2: ("rollup_not_found", "rollup not found", None),
    3: ("rollup_already_exists", "rollup already exists", None),
    4: ("rollup_not_active", "rollup not active", None),
    5: ("max_rollups_reached", "maximum rollups reached", "every max_rollups slot is taken"),
    6: ("insufficient_stake", "insufficient stake amount", "stake at least min_stake_for_rollup"),
    7: ("unauthorized", "only the rollup creator can do this", None),
    8: ("batch_not_found", "batch not found", None),
    9: ("batch_exists", "a batch with this index already exists", None),
    10: (
        "challenge_window_closed",
        "challenge window closed or not applicable",
        "a batch can be challenged only while its own window is open",
    ),
    11: ("invalid_proof", "invalid proof", None),
    12: ("proof_required", "proof required for this settlement mode", None),
    13: ("da_blob_too_large", "DA blob exceeds the maximum size", None),
    14: ("da_blob_not_found", "DA blob not found", None),
    15: ("celestia_unavailable", "Celestia data availability is not active", None),
    16: ("invalid_settlement_mode", "invalid settlement mode", None),
    17: ("invalid_sequencer_mode", "invalid sequencer mode", None),
    18: ("invalid_proof_system", "invalid proof system", None),
    19: ("based_sequencer_only", "based settlement requires a based sequencer", None),
    20: ("challenge_bond_required", "a challenge bond is required", None),
    21: (
        "verification_key_missing",
        "ZK verification key not configured for the rollup",
        "register one with MsgSetVerificationKey (chain v3.2.7+) before the rollup's first batch",
    ),
    22: ("stark_not_supported", "STARK verification is not available for this rollup", None),
    23: ("proof_verify_failed", "ZK proof verification failed", None),
    24: ("no_open_challenge", "no open challenge for this batch", None),
    25: ("batch_not_challenged", "batch is not challenged", None),
    26: (
        "data_unavailable",
        "no DA blob matches the batch's data hash",
        "post the data with MsgPostRollupData (chain v3.2.8+) and carry its SHA-256, or leave data_hash empty",
    ),
    27: ("batch_not_finalized", "withdrawals need a finalized batch", None),
    28: ("withdrawal_already_done", "withdrawal already executed", None),
    29: (
        "invalid_withdrawal_proof",
        "withdrawal proof does not match the batch's withdrawals root",
        "build it with withdrawalsTree, using the batch's own binding (v2 from chain v3.2.5)",
    ),
    30: ("invalid_rollup_id", "invalid rollup id", None),
    31: (
        "anchor_refused",
        "the batch's signed state anchor was refused",
        "only the rollup creator's registered post-quantum key can sign the anchor",
    ),
    32: ("insufficient_escrow", "the rollup's escrow does not cover the withdrawal", None),
    33: ("invalid_withdrawal", "malformed withdrawal message", None),
    34: (
        "params_update_disabled",
        "rdk parameter updates are not enabled at this height",
        None,
    ),
    35: ("invalid_params", "invalid rdk parameters", None),
    36: (
        "settlement_pending",
        "the rollup has a batch that is not settled yet",
        "a rollup cannot be stopped, and cannot take more than 4096 waiting batches, while "
        "batches are unsettled",
    ),
    37: (
        "verification_key_disabled",
        "verification key registration is not enabled at this height",
        None,
    ),
    38: ("invalid_verification_key", "invalid ZK verification key", None),
    39: (
        "verification_key_locked",
        "the verification key can only be changed by governance after the first batch",
        None,
    ),
    40: (
        "batch_limit_reached",
        "the rollup reached max_batches_per_block in this block",
        None,
    ),
    41: ("rollup_data_disabled", "rollup data posting is not enabled at this height", None),
    42: (
        "rollup_data_too_large",
        "rollup data exceeds the per-message limit",
        "see max_posted_data_bytes",
    ),
    43: (
        "rollup_data_block_full",
        "the rollup data limit for this block is reached",
        "retry in a later block",
    ),
    44: ("based_sequencing_disabled", "based sequencing is not enabled at this height", None),
    45: (
        "based_sequencing_unsupported",
        "based sequencing is not available for this rollup",
        "zk (snark), based settlement and qledger-v1 optimistic rollups only",
    ),
    46: (
        "invalid_inbox_range",
        "the batch does not match the rollup inbox",
        "data_hash must be the inbox range commitment up to inbox_end; inbox_end must be 0 "
        "on a rollup that is not based",
    ),
    47: ("rollup_mode_disabled", "this rollup mode is not enabled at this height", None),
    48: (
        "invalid_rollup_mode",
        "invalid rollup execution or privacy mode",
        "a new optimistic rollup needs execution_vm qledger-v1 and based sequencing; a "
        "private rollup must be zk with a Groth16 key",
    ),
    49: (
        "submitter_bond_required",
        "submitter bond required",
        "bond at least min_submitter_bond first",
    ),
    50: (
        "submitter_bond_locked",
        "the submitter bond is still locked",
        "a full challenge window must pass after the submitter's last batch",
    ),
    51: ("fraud_not_proven", "the fraud proof does not show the batch invalid", None),
    52: (
        "stark_statement_unsupported",
        "this STARK verification key proves no rollup statement",
        "STARK settlement is paused; use a Groth16 (snark) key",
    ),
    53: (
        "invalid_envelope",
        "the post is not a valid envelope to the rollup's members",
        None,
    ),
    54: ("deposit_pool_not_empty", "the rollup still holds user deposits", None),
}


@dataclass
class DecodedRdkTxError:
    """A refused transaction, named."""

    code: int
    codespace: str
    #: A stable name, e.g. ``"invalid_rollup_mode"``.
    kind: str
    #: The message, with the hint in parentheses when there is one.
    message: str
    hint: Optional[str] = None
    raw_log: Optional[str] = None


def decode_rdk_tx_error(
    code: int, codespace: Optional[str] = None, raw_log: Optional[str] = None
) -> DecodedRdkTxError:
    """The SDK's ``decode_tx_error``, plus the ``rdk`` codespace: an ``rdk``
    code from :data:`RDK_ERRORS` is named here; anything else is decoded by
    the SDK (which falls back to the raw log for a module's own codes)."""
    info = RDK_ERRORS.get(int(code)) if codespace == "rdk" else None
    if info is not None:
        kind, message, hint = info
        return DecodedRdkTxError(
            code=int(code),
            codespace="rdk",
            kind=kind,
            message=f"{message} ({hint})" if hint else message,
            hint=hint,
            raw_log=raw_log,
        )
    from qorsdk.errors import decode_tx_error

    decoded = decode_tx_error(code, codespace, raw_log)
    return DecodedRdkTxError(
        code=decoded.code,
        codespace=decoded.codespace,
        kind=decoded.kind,
        message=decoded.message,
        raw_log=decoded.raw_log,
    )


__all__ = ["RDK_ERRORS", "DecodedRdkTxError", "decode_rdk_tx_error"]
