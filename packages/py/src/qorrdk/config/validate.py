"""Validate a rollup configuration against the on-chain rules."""

from __future__ import annotations

import re
from typing import Optional
from dataclasses import dataclass, field

from ..rules import rollup_id_error
from ..enums import (
    DA_BACKENDS,
    EXECUTION_VMS,
    GAS_MODELS,
    PAUSED_PROOF_SYSTEMS,
    PROOF_SYSTEMS,
    ROLLUP_PRIVACY_MODES,
    SEQUENCER_MODES,
    SEQUENCING_MODES,
    SETTLEMENT_PARADIGMS,
    is_vm_type,
)
from .errors import RollupConfigError
from .matrix import (
    is_proof_compatible,
    requires_based_sequencer,
    valid_proof_systems,
)
from .types import RollupConfig

_POSITIVE_INT_STRING = re.compile(r"^[1-9][0-9]*$")


@dataclass
class ValidationResult:
    """The outcome of validating a :class:`RollupConfig`."""

    #: True when there are no errors (warnings do not affect validity).
    valid: bool
    #: Hard failures that block submission.
    errors: list[str] = field(default_factory=list)
    #: Non-fatal notices (e.g. selecting a not-yet-active DA backend).
    warnings: list[str] = field(default_factory=list)


def _is_positive_integer_string(value: str) -> bool:
    return bool(_POSITIVE_INT_STRING.match(value))


def _is_positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _val(value: object) -> str:
    """Coerce an enum or plain value to its wire string for messages/membership."""
    return getattr(value, "value", value)


def validate_rollup_config(config: RollupConfig) -> ValidationResult:
    """Validate a rollup configuration.

    Checks the settlement -> proof compatibility matrix, the
    based-settlement => based-sequencer constraint, the closed value sets, and
    basic field sanity. Returns a structured result; callers that prefer to fail
    fast can use :func:`assert_valid_rollup_config`.
    """
    errors: list[str] = []
    warnings: list[str] = []

    settlement = _val(config.settlement)
    sequencer = _val(config.sequencer)
    proof_system = _val(config.proof_system)
    da = _val(config.da)
    gas_model = _val(config.gas_model)
    vm_type = _val(config.vm_type)

    if not config.rollup_id or config.rollup_id.strip() == "":
        errors.append("rollup_id must be a non-empty string")
    else:
        # The chain enforces this at creation from v3.2.2; checking here means a
        # refused id costs nothing instead of a creation fee.
        id_error = rollup_id_error(config.rollup_id)
        if id_error:
            errors.append(f'rollup_id "{config.rollup_id}" {id_error}')

    if settlement not in SETTLEMENT_PARADIGMS:
        errors.append(
            f'settlement "{settlement}" is not a valid settlement paradigm'
        )
    if sequencer not in SEQUENCER_MODES:
        errors.append(f'sequencer "{sequencer}" is not a valid sequencer mode')
    if proof_system not in PROOF_SYSTEMS:
        errors.append(
            f'proof_system "{proof_system}" is not a valid proof system'
        )
    if da not in DA_BACKENDS:
        errors.append(f'da "{da}" is not a valid data-availability backend')
    if gas_model not in GAS_MODELS:
        errors.append(f'gas_model "{gas_model}" is not a valid gas model')
    if not is_vm_type(vm_type):
        errors.append(f'vm_type "{vm_type}" is not a valid VM type')

    # Compatibility matrix (only meaningful once both values are valid).
    if (
        settlement in SETTLEMENT_PARADIGMS
        and proof_system in PROOF_SYSTEMS
        and not is_proof_compatible(settlement, proof_system)
    ):
        expected = ", ".join(p.value for p in valid_proof_systems(settlement))
        errors.append(
            f'proof system "{proof_system}" is not compatible with '
            f'"{settlement}" settlement (expected one of: {expected})'
        )

    # STARK settlement is refused by the chain from v3.2.8.
    if proof_system in PAUSED_PROOF_SYSTEMS:
        errors.append(
            f'proof system "{proof_system}" is paused on the network: the chain refuses '
            "STARK keys and STARK batches until it verifies a real rollup statement; "
            "use snark (Groth16)"
        )

    # Sequencing, execution VM and privacy (chain v3.2.8+), mirroring the
    # chain's RollupConfig.Validate and its create-time rule.
    errors.extend(
        rollup_mode_errors(
            settlement=settlement,
            proof_system=proof_system,
            sequencing=config.sequencing,
            execution_vm=config.execution_vm,
            privacy=config.privacy,
        )
    )

    # Based settlement requires the based sequencer mode.
    if (
        settlement in SETTLEMENT_PARADIGMS
        and requires_based_sequencer(settlement)
        and sequencer != "based"
    ):
        errors.append('based settlement requires the "based" sequencer mode')

    if not _is_positive_int(config.block_time_ms):
        errors.append("block_time_ms must be a positive integer")
    if not _is_positive_int(config.max_tx_per_block):
        errors.append("max_tx_per_block must be a positive integer")

    if config.stake_amount_uqor is not None and not _is_positive_integer_string(
        config.stake_amount_uqor
    ):
        errors.append(
            "stake_amount_uqor must be a positive integer string (base uqor)"
        )
    if config.challenge_window_secs is not None and not _is_positive_int(
        config.challenge_window_secs
    ):
        errors.append("challenge_window_secs must be a positive integer")
    if config.max_da_blob_size is not None and not _is_positive_int(
        config.max_da_blob_size
    ):
        errors.append("max_da_blob_size must be a positive integer (bytes)")

    # Celestia is a selectable but not-yet-active backend on the network.
    if da in ("celestia", "both"):
        warnings.append(
            "Celestia data availability is selectable but not yet active on the "
            "network; batches targeting it will not be served until it is enabled."
        )

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)


def assert_valid_rollup_config(config: RollupConfig) -> None:
    """Validate a configuration and raise :class:`RollupConfigError` on error."""
    result = validate_rollup_config(config)
    if not result.valid:
        raise RollupConfigError(result.errors)


def rollup_mode_errors(
    *,
    settlement: object,
    proof_system: object,
    sequencing: Optional[object] = None,
    execution_vm: Optional[object] = None,
    privacy: Optional[object] = None,
) -> list[str]:
    """The chain's v3.2.8 rules for ``sequencing``, ``execution_vm`` and
    ``privacy`` on a new rollup. Returns every violation (empty when the
    combination is accepted).

    - A new optimistic rollup needs ``execution_vm="qledger-v1"`` and
      ``sequencing="based"``.
    - ``sequencing="based"`` is allowed for zk with snark, based settlement,
      and optimistic with qledger-v1.
    - ``execution_vm="qledger-v1"`` needs optimistic settlement, based
      sequencing, and no privacy.
    - ``privacy="encapsulated"`` needs zk settlement with snark.
    """
    errors: list[str] = []
    settlement = _val(settlement)
    proof_system = _val(proof_system)
    sequencing = _val(sequencing) or ""
    execution_vm = _val(execution_vm) or ""
    privacy = _val(privacy) or ""
    if sequencing not in SEQUENCING_MODES:
        errors.append(f'sequencing "{sequencing}" is not valid (want "based" or empty)')
    if execution_vm not in EXECUTION_VMS:
        errors.append(f'execution_vm "{execution_vm}" is not valid (want "qledger-v1" or empty)')
    if privacy not in ROLLUP_PRIVACY_MODES:
        errors.append(f'privacy "{privacy}" is not valid (want "encapsulated" or empty)')
    if settlement == "optimistic" and execution_vm == "":
        errors.append(
            'from chain v3.2.8 a new optimistic rollup needs execution_vm "qledger-v1" and '
            'sequencing "based" (its fraud proof re-executes the batch)'
        )
    if sequencing == "based":
        eligible = (
            (settlement == "zk" and proof_system == "snark")
            or settlement == "based"
            or (settlement == "optimistic" and execution_vm == "qledger-v1")
        )
        if not eligible:
            errors.append(
                f"settlement {settlement} with proof system {proof_system} cannot use based "
                "sequencing (zk with snark, based settlement, or optimistic with qledger-v1 only)"
            )
    if execution_vm == "qledger-v1":
        if settlement != "optimistic":
            errors.append(
                f"execution_vm qledger-v1 needs optimistic settlement, not {settlement}"
            )
        if sequencing != "based":
            errors.append(
                'execution_vm qledger-v1 needs sequencing "based": its batches consume the inbox'
            )
        if privacy != "":
            errors.append(
                "a qledger-v1 rollup cannot be private: a fraud proof re-executes plaintext"
            )
    if privacy == "encapsulated" and not (settlement == "zk" and proof_system == "snark"):
        errors.append(
            "a private rollup must be zk with a snark (Groth16) key, not "
            f"{settlement}/{proof_system}"
        )
    return errors


__all__ = [
    "rollup_mode_errors",
    "ValidationResult",
    "validate_rollup_config",
    "assert_valid_rollup_config",
]
