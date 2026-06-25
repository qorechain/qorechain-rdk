"""Typed rollup configuration objects.

A :class:`RollupConfig` captures a rollup's resolved settlement, sequencing,
data availability, gas, and timing for client-side validation, display, and to
build ``MsgCreateRollup``. On creation the chain derives the authoritative
configuration from the chosen ``profile`` (and ``vm_type``); field overrides
beyond those two are used for local validation and clarity.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

from ..enums import (
    DABackend,
    GasModel,
    ProfileName,
    ProofSystem,
    SequencerMode,
    SettlementParadigm,
    VmType,
)


@dataclass
class SequencerParams:
    """Mode-specific sequencer parameters.

    Which fields apply depends on the sequencer mode: ``dedicated`` uses
    ``sequencer_address``, ``shared`` uses ``shared_set_min_size``, and ``based``
    uses ``inclusion_delay`` / ``priority_fee_share``.
    """

    #: ``dedicated``: the operator address that sequences the rollup.
    sequencer_address: Optional[str] = None
    #: ``shared``: minimum size of the shared sequencer set.
    shared_set_min_size: Optional[int] = None
    #: ``based``: blocks of inclusion delay for host-chain proposers.
    inclusion_delay: Optional[int] = None
    #: ``based``: share of priority fees routed to proposers, as a decimal string.
    priority_fee_share: Optional[str] = None

    def copy(self) -> "SequencerParams":
        return replace(self)

    def merged(self, overrides: "SequencerParams") -> "SequencerParams":
        """Return a copy with ``overrides``' set (non-None) fields applied."""
        out = self.copy()
        for name in (
            "sequencer_address",
            "shared_set_min_size",
            "inclusion_delay",
            "priority_fee_share",
        ):
            value = getattr(overrides, name)
            if value is not None:
                setattr(out, name, value)
        return out


@dataclass
class RollupConfig:
    """A fully resolved rollup configuration."""

    #: Unique rollup identifier.
    rollup_id: str
    #: The preset profile this configuration is based on.
    profile: ProfileName
    #: Settlement paradigm.
    settlement: SettlementParadigm
    #: Sequencer mode.
    sequencer: SequencerMode
    #: Data-availability backend.
    da: DABackend
    #: Proof system (must be compatible with ``settlement``).
    proof_system: ProofSystem
    #: Gas / fee model.
    gas_model: GasModel
    #: Execution environment.
    vm_type: VmType
    #: Target block time, in milliseconds.
    block_time_ms: int
    #: Maximum transactions per rollup block.
    max_tx_per_block: int
    #: Mode-specific sequencer parameters.
    sequencer_params: Optional[SequencerParams] = None
    #: Optimistic challenge window, in seconds.
    challenge_window_secs: Optional[int] = None
    #: Optimistic challenge bond, in uqor.
    challenge_bond_uqor: Optional[str] = None
    #: Maximum DA blob size, in bytes.
    max_da_blob_size: Optional[int] = None
    #: Stake committed at creation, in uqor. Required to build a create message.
    stake_amount_uqor: Optional[str] = None

    def copy(self) -> "RollupConfig":
        sp = self.sequencer_params.copy() if self.sequencer_params else None
        return replace(self, sequencer_params=sp)


@dataclass(frozen=True)
class CreateRollupMsgInput:
    """Inputs for an on-chain ``MsgCreateRollup``, as the kit submits them."""

    creator: str
    rollup_id: str
    profile: ProfileName
    vm_type: VmType
    stake_amount: str


__all__ = ["SequencerParams", "RollupConfig", "CreateRollupMsgInput"]
