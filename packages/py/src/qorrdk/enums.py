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
    """The proof a settlement batch carries.

    ``STARK`` stays so rollups created before can be read, but the chain
    refuses STARK settlement from v3.2.8: a STARK key cannot be set and a STARK
    rollup's batches are refused until the chain verifies a real rollup
    statement. New rollups use ``SNARK`` (see :data:`PAUSED_PROOF_SYSTEMS`).
    """

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

    - ``EVM`` -- Ethereum/Solidity.
    - ``NATIVE`` -- the QoreChain Native runtime (Wasm smart contracts).
    - ``SVM`` -- the Solana VM.
    - ``CUSTOM`` -- an application-defined VM.

    ``COSMWASM`` is accepted as a legacy alias of ``NATIVE`` and is what both map
    to on the wire (the network, explorer, and dashboard use ``cosmwasm``). It is
    not part of the advertised :data:`VM_TYPES`.
    """

    EVM = "evm"
    NATIVE = "native"
    SVM = "svm"
    CUSTOM = "custom"
    #: Legacy alias of :attr:`NATIVE`; the on-chain wire value both resolve to.
    COSMWASM = "cosmwasm"


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
#: The advertised VM types (``native`` is the QoreChain Native runtime). The
#: ``cosmwasm`` legacy alias is accepted by :func:`is_vm_type` but not advertised.
VM_TYPES: tuple[str, ...] = ("evm", "native", "svm", "custom")
ROLLUP_STATUSES: tuple[str, ...] = tuple(m.value for m in RollupStatus)
BATCH_STATUSES: tuple[str, ...] = tuple(m.value for m in BatchStatus)
PROFILE_NAMES: tuple[str, ...] = tuple(m.value for m in ProfileName)

#: Proof systems the chain currently refuses for new rollups and new batches.
PAUSED_PROOF_SYSTEMS: tuple[str, ...] = (ProofSystem.STARK.value,)

#: How a rollup's transactions are ordered (chain v3.2.8+): ``""``, the
#: rollup's sequencer settles; ``"based"``, anyone posts data, the order is
#: inclusion on the chain, and every batch consumes the inbox in order. Not the
#: same as :class:`SequencerMode`, which is descriptive and has no effect on chain.
SEQUENCING_MODES: tuple[str, ...] = ("", "based")

#: The execution model the chain re-executes in an optimistic fraud proof
#: (chain v3.2.8+). ``qledger-v1`` is a uqor account ledger with signed
#: transfers and withdrawals; every new optimistic rollup needs it.
EXECUTION_VMS: tuple[str, ...] = ("", "qledger-v1")

#: Rollup privacy (chain v3.2.8+): ``"encapsulated"`` posts are ML-KEM-1024
#: envelopes to the members.
ROLLUP_PRIVACY_MODES: tuple[str, ...] = ("", "encapsulated")

#: Most members a private rollup can have.
MAX_ROLLUP_MEMBERS = 32

_ACCEPTED_VM_TYPES: frozenset[str] = frozenset((*VM_TYPES, "cosmwasm"))


def is_vm_type(value: object) -> bool:
    """Whether ``value`` is a VM type the RDK accepts (includes the ``cosmwasm`` alias)."""
    return getattr(value, "value", value) in _ACCEPTED_VM_TYPES


def vm_type_wire_value(vm_type: object) -> str:
    """The on-chain wire value for a VM type.

    The QoreChain Native runtime (``native``) is transmitted as ``cosmwasm`` for
    consistency with the network, explorer, and dashboard; all other values pass
    through unchanged.
    """
    value = str(getattr(vm_type, "value", vm_type))
    return "cosmwasm" if value == "native" else value


def vm_type_label(vm_type: object) -> str:
    """A human-readable label for a VM type (the Wasm runtime reads as QoreChain Native)."""
    value = str(getattr(vm_type, "value", vm_type))
    if value in ("native", "cosmwasm"):
        return "QoreChain Native"
    if value == "evm":
        return "EVM"
    if value == "svm":
        return "SVM"
    if value == "custom":
        return "Custom"
    return value


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
    "PAUSED_PROOF_SYSTEMS",
    "SEQUENCING_MODES",
    "EXECUTION_VMS",
    "ROLLUP_PRIVACY_MODES",
    "MAX_ROLLUP_MEMBERS",
    "is_vm_type",
    "vm_type_wire_value",
    "vm_type_label",
]
