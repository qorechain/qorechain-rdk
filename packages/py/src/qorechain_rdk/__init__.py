"""Python Rollup Development Kit for the QoreChain network.

**Status: coming soon.** This package mirrors the conceptual surface of the
TypeScript RDK (``@qorechain/rdk``). The enums and constants exported here are
stable today; the client surface raises ``NotImplementedError`` until released.

Planned surface (following the TypeScript reference implementation):

* Typed rollup configuration and a builder, with the settlement / sequencer /
  proof / DA / gas / VM compatibility matrix validated client-side.
* The five preset profiles -- ``defi``, ``gaming``, ``nft``, ``enterprise``,
  and ``custom`` -- pre-filled with their documented defaults.
* Lifecycle, settlement-batch, and native data-availability clients.
* Read clients for rollups, batches, and module parameters.
"""

from __future__ import annotations

from ._coming_soon import create_rdk_client
from .constants import (
    ACCOUNT_PREFIX,
    BASE_DENOM,
    CHAIN_IDS,
    DEFAULT_CHALLENGE_BOND_UQOR,
    DEFAULT_RDK_PARAMS,
    DENOM_EXPONENT,
    DISPLAY_DENOM,
    VALIDATOR_PREFIX,
)
from .enums import (
    BATCH_STATUSES,
    DA_BACKENDS,
    GAS_MODELS,
    PROFILE_NAMES,
    PROOF_SYSTEMS,
    ROLLUP_STATUSES,
    SEQUENCER_MODES,
    SETTLEMENT_PARADIGMS,
    VM_TYPES,
    BatchStatus,
    DABackend,
    GasModel,
    ProfileName,
    ProofSystem,
    RollupStatus,
    SequencerMode,
    SettlementParadigm,
    VmType,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "create_rdk_client",
    # enums
    "SettlementParadigm",
    "SequencerMode",
    "ProofSystem",
    "DABackend",
    "GasModel",
    "VmType",
    "RollupStatus",
    "BatchStatus",
    "ProfileName",
    "SETTLEMENT_PARADIGMS",
    "SEQUENCER_MODES",
    "PROOF_SYSTEMS",
    "DA_BACKENDS",
    "GAS_MODELS",
    "VM_TYPES",
    "ROLLUP_STATUSES",
    "BATCH_STATUSES",
    "PROFILE_NAMES",
    # constants
    "DISPLAY_DENOM",
    "BASE_DENOM",
    "DENOM_EXPONENT",
    "ACCOUNT_PREFIX",
    "VALIDATOR_PREFIX",
    "CHAIN_IDS",
    "DEFAULT_RDK_PARAMS",
    "DEFAULT_CHALLENGE_BOND_UQOR",
]
