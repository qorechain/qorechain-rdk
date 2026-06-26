"""The five preset profiles and their documented default fields.

These mirror the network's published profile table. The proof system for each
profile is the one its settlement paradigm requires (optimistic -> fraud,
zk -> snark, based -> none).
"""

from __future__ import annotations

from typing import Callable

from .config.builder import RollupConfigBuilder
from .config.types import RollupConfig, SequencerParams
from .constants import DEFAULT_CHALLENGE_BOND_UQOR, DEFAULT_RDK_PARAMS
from .enums import (
    DABackend,
    GasModel,
    ProfileName,
    ProofSystem,
    SequencerMode,
    SettlementParadigm,
    VmType,
)

_DEFAULT_CHALLENGE_WINDOW = int(DEFAULT_RDK_PARAMS["default_challenge_window"])

#: Resolved preset fields, keyed by profile. Each maps to the keyword arguments
#: for a :class:`RollupConfig` (minus ``rollup_id`` and ``stake_amount_uqor``).
PRESET_DEFAULTS: dict[ProfileName, dict] = {
    ProfileName.DEFI: {
        "profile": ProfileName.DEFI,
        "settlement": SettlementParadigm.ZK,
        "sequencer": SequencerMode.DEDICATED,
        "da": DABackend.NATIVE,
        "proof_system": ProofSystem.SNARK,
        "gas_model": GasModel.EIP1559,
        "vm_type": VmType.EVM,
        "block_time_ms": 500,
        "max_tx_per_block": 10000,
    },
    ProfileName.GAMING: {
        "profile": ProfileName.GAMING,
        "settlement": SettlementParadigm.BASED,
        "sequencer": SequencerMode.BASED,
        "da": DABackend.NATIVE,
        "proof_system": ProofSystem.NONE,
        "gas_model": GasModel.FLAT,
        "vm_type": VmType.CUSTOM,
        "block_time_ms": 200,
        "max_tx_per_block": 50000,
    },
    ProfileName.NFT: {
        "profile": ProfileName.NFT,
        "settlement": SettlementParadigm.OPTIMISTIC,
        "sequencer": SequencerMode.DEDICATED,
        "da": DABackend.CELESTIA,
        "proof_system": ProofSystem.FRAUD,
        "gas_model": GasModel.STANDARD,
        "vm_type": VmType.COSMWASM,
        "block_time_ms": 2000,
        "max_tx_per_block": 5000,
        "challenge_window_secs": _DEFAULT_CHALLENGE_WINDOW,
        "challenge_bond_uqor": DEFAULT_CHALLENGE_BOND_UQOR,
    },
    ProfileName.ENTERPRISE: {
        "profile": ProfileName.ENTERPRISE,
        "settlement": SettlementParadigm.BASED,
        "sequencer": SequencerMode.BASED,
        "da": DABackend.NATIVE,
        "proof_system": ProofSystem.NONE,
        "gas_model": GasModel.SUBSIDIZED,
        "vm_type": VmType.EVM,
        "block_time_ms": 1000,
        "max_tx_per_block": 20000,
    },
    ProfileName.CUSTOM: {
        "profile": ProfileName.CUSTOM,
        "settlement": SettlementParadigm.OPTIMISTIC,
        "sequencer": SequencerMode.DEDICATED,
        "da": DABackend.NATIVE,
        "proof_system": ProofSystem.FRAUD,
        "gas_model": GasModel.STANDARD,
        "vm_type": VmType.EVM,
        "block_time_ms": 1000,
        "max_tx_per_block": 10000,
        "challenge_window_secs": _DEFAULT_CHALLENGE_WINDOW,
        "challenge_bond_uqor": DEFAULT_CHALLENGE_BOND_UQOR,
    },
}


def _make_preset(name: ProfileName) -> Callable[..., RollupConfigBuilder]:
    def preset(rollup_id: str = "", **overrides: object) -> RollupConfigBuilder:
        base = dict(PRESET_DEFAULTS[name])
        sequencer_params = overrides.pop("sequencer_params", None)
        if isinstance(sequencer_params, dict):
            sequencer_params = SequencerParams(**sequencer_params)
        base.update(overrides)
        base["rollup_id"] = rollup_id
        base["profile"] = name
        config = RollupConfig(sequencer_params=sequencer_params, **base)
        return RollupConfigBuilder(config)

    preset.__name__ = f"preset_{name.value}"
    preset.__doc__ = (
        f"Build a RollupConfigBuilder for the '{name.value}' profile, applying any "
        "keyword overrides on top of the profile's documented defaults."
    )
    return preset


class _Presets:
    """First-class preset profiles. Each returns a :class:`RollupConfigBuilder`."""

    defi = staticmethod(_make_preset(ProfileName.DEFI))
    gaming = staticmethod(_make_preset(ProfileName.GAMING))
    nft = staticmethod(_make_preset(ProfileName.NFT))
    enterprise = staticmethod(_make_preset(ProfileName.ENTERPRISE))
    custom = staticmethod(_make_preset(ProfileName.CUSTOM))


#: Singleton holding the five preset builders.
presets = _Presets()


__all__ = ["PRESET_DEFAULTS", "presets"]
