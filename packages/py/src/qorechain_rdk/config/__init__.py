"""Rollup configuration: types, the compatibility matrix, validation, builder."""

from __future__ import annotations

from .builder import RollupConfigBuilder
from .errors import RollupConfigError
from .matrix import (
    SETTLEMENT_PROOF_MATRIX,
    is_proof_compatible,
    requires_based_sequencer,
    valid_proof_systems,
)
from .networks import (
    NETWORKS,
    Endpoints,
    NetworkConfig,
    get_network,
    list_networks,
)
from .types import CreateRollupMsgInput, RollupConfig, SequencerParams
from .validate import (
    ValidationResult,
    assert_valid_rollup_config,
    validate_rollup_config,
)

__all__ = [
    "RollupConfig",
    "SequencerParams",
    "CreateRollupMsgInput",
    "RollupConfigBuilder",
    "RollupConfigError",
    "SETTLEMENT_PROOF_MATRIX",
    "valid_proof_systems",
    "is_proof_compatible",
    "requires_based_sequencer",
    "ValidationResult",
    "validate_rollup_config",
    "assert_valid_rollup_config",
    "Endpoints",
    "NetworkConfig",
    "NETWORKS",
    "get_network",
    "list_networks",
]
