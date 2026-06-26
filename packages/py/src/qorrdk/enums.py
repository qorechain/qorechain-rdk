"""Closed value sets accepted by the QoreChain ``rdk`` module.

These mirror the on-chain ``rdk`` module exactly. The string values are the wire
values the chain expects -- do not localize or re-case them. Each enum is a
``str`` enum so members compare equal to their wire string.
"""

from __future__ import annotations

from enum import Enum


class SettlementParadigm(str, Enum):
    """How a rollup settles to the Main Chain."""

    OPTIMISTIC = "optimistic"
    ZK = "zk"
    BASED = "based"
    SOVEREIGN = "sovereign"


class SequencerMode(str, Enum):
    """Who orders the rollup's transactions."""

    DEDICATED = "dedicated"
    SHARED = "shared"
    BASED = "based"


class ProofSystem(str, Enum):
    """The proof a settlement batch carries."""

    FRAUD = "fraud"
    SNARK = "snark"
    STARK = "stark"
    NONE = "none"


class DABackend(str, Enum):
    """Where rollup data is made available."""

    NATIVE = "native"
    CELESTIA = "celestia"
    BOTH = "both"


class GasModel(str, Enum):
    """The fee model the rollup charges."""

    STANDARD = "standard"
    EIP1559 = "eip1559"
    FLAT = "flat"
    SUBSIDIZED = "subsidized"


class VmType(str, Enum):
    """The execution environment the rollup exposes.

    ``custom`` denotes an application-defined VM; the wire value may be any
    identifier the network recognizes.
    """

    EVM = "evm"
    COSMWASM = "cosmwasm"
    SVM = "svm"
    CUSTOM = "custom"


class RollupStatus(str, Enum):
    """Rollup lifecycle states."""

    PENDING = "pending"
    ACTIVE = "active"
    PAUSED = "paused"
    STOPPED = "stopped"


class BatchStatus(str, Enum):
    """Settlement-batch lifecycle states."""

    SUBMITTED = "submitted"
    CHALLENGED = "challenged"
    FINALIZED = "finalized"
    REJECTED = "rejected"


class ProfileName(str, Enum):
    """The five preset profiles."""

    DEFI = "defi"
    GAMING = "gaming"
    NFT = "nft"
    ENTERPRISE = "enterprise"
    CUSTOM = "custom"


SETTLEMENT_PARADIGMS: tuple[str, ...] = tuple(m.value for m in SettlementParadigm)
SEQUENCER_MODES: tuple[str, ...] = tuple(m.value for m in SequencerMode)
PROOF_SYSTEMS: tuple[str, ...] = tuple(m.value for m in ProofSystem)
DA_BACKENDS: tuple[str, ...] = tuple(m.value for m in DABackend)
GAS_MODELS: tuple[str, ...] = tuple(m.value for m in GasModel)
VM_TYPES: tuple[str, ...] = tuple(m.value for m in VmType)
ROLLUP_STATUSES: tuple[str, ...] = tuple(m.value for m in RollupStatus)
BATCH_STATUSES: tuple[str, ...] = tuple(m.value for m in BatchStatus)
PROFILE_NAMES: tuple[str, ...] = tuple(m.value for m in ProfileName)

__all__ = [
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
]
