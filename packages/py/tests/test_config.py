"""Matrix, validation, and builder tests."""

from __future__ import annotations

import pytest

from qorechain_rdk import (
    ProfileName,
    ProofSystem,
    RollupConfigError,
    SequencerMode,
    SettlementParadigm,
    is_proof_compatible,
    presets,
    requires_based_sequencer,
    valid_proof_systems,
    validate_rollup_config,
)
from qorechain_rdk.config import SETTLEMENT_PROOF_MATRIX


def test_matrix_pairings():
    assert valid_proof_systems(SettlementParadigm.OPTIMISTIC) == (ProofSystem.FRAUD,)
    assert valid_proof_systems(SettlementParadigm.ZK) == (
        ProofSystem.SNARK,
        ProofSystem.STARK,
    )
    assert valid_proof_systems(SettlementParadigm.BASED) == (ProofSystem.NONE,)
    assert valid_proof_systems(SettlementParadigm.SOVEREIGN) == (ProofSystem.NONE,)


def test_matrix_covers_all_settlements():
    assert set(SETTLEMENT_PROOF_MATRIX.keys()) == set(SettlementParadigm)


@pytest.mark.parametrize(
    "settlement,proof,ok",
    [
        (SettlementParadigm.OPTIMISTIC, ProofSystem.FRAUD, True),
        (SettlementParadigm.OPTIMISTIC, ProofSystem.SNARK, False),
        (SettlementParadigm.ZK, ProofSystem.SNARK, True),
        (SettlementParadigm.ZK, ProofSystem.STARK, True),
        (SettlementParadigm.ZK, ProofSystem.FRAUD, False),
        (SettlementParadigm.BASED, ProofSystem.NONE, True),
        (SettlementParadigm.BASED, ProofSystem.SNARK, False),
        (SettlementParadigm.SOVEREIGN, ProofSystem.NONE, True),
    ],
)
def test_is_proof_compatible(settlement, proof, ok):
    assert is_proof_compatible(settlement, proof) is ok


def test_requires_based_sequencer():
    assert requires_based_sequencer(SettlementParadigm.BASED) is True
    assert requires_based_sequencer(SettlementParadigm.ZK) is False


def test_valid_preset_passes_validation():
    config = presets.defi("my-rollup").build()
    result = validate_rollup_config(config)
    assert result.valid
    assert result.errors == []


def test_incompatible_proof_pair_fails():
    builder = presets.defi("r").set(proof_system=ProofSystem.FRAUD)
    result = builder.validation_result()
    assert not result.valid
    assert any("not compatible" in e for e in result.errors)


def test_based_settlement_requires_based_sequencer():
    builder = presets.gaming("r").set(sequencer=SequencerMode.DEDICATED)
    result = builder.validation_result()
    assert not result.valid
    assert any("based" in e and "sequencer" in e for e in result.errors)


def test_empty_rollup_id_fails():
    builder = presets.defi("")
    result = builder.validation_result()
    assert not result.valid
    assert any("rollup_id" in e for e in result.errors)


def test_field_sanity_block_time():
    builder = presets.defi("r").set(block_time_ms=0)
    result = builder.validation_result()
    assert not result.valid
    assert any("block_time_ms" in e for e in result.errors)


def test_celestia_warning_not_fatal():
    config = presets.nft("r").build()  # nft uses celestia
    result = validate_rollup_config(config)
    assert result.valid
    assert any("Celestia" in w for w in result.warnings)


def test_builder_validate_raises():
    with pytest.raises(RollupConfigError):
        presets.defi("r").set(proof_system=ProofSystem.FRAUD).validate()


def test_builder_set_merges_sequencer_params():
    builder = presets.defi("r").set(sequencer_params={"sequencer_address": "qor1seq"})
    builder.set(sequencer_params={"inclusion_delay": 3})
    config = builder.get()
    assert config.sequencer_params.sequencer_address == "qor1seq"
    assert config.sequencer_params.inclusion_delay == 3


def test_to_create_msg_requires_stake():
    builder = presets.defi("r")
    with pytest.raises(RollupConfigError):
        builder.to_create_msg("qor1creator")
    msg = builder.to_create_msg("qor1creator", stake_amount="10000000000")
    assert msg.creator == "qor1creator"
    assert msg.rollup_id == "r"
    assert msg.profile == ProfileName.DEFI
    assert msg.stake_amount == "10000000000"
