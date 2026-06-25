"""Manifest round-trip."""

from __future__ import annotations

import pytest

from qorechain_rdk import (
    SequencerParams,
    from_manifest,
    parse_manifest,
    presets,
    stringify_manifest,
    to_manifest,
)


def _config():
    return (
        presets.defi("my-rollup")
        .set(
            stake_amount_uqor="10000000000",
            sequencer_params={"sequencer_address": "qor1seq", "inclusion_delay": 2},
        )
        .build()
    )


def test_manifest_round_trip_json():
    config = _config()
    manifest = to_manifest(
        config,
        network="testnet",
        chain_id="qorechain-diana",
        endpoints={"rest": "http://localhost:1317"},
        addresses={"creator": "qor1creator"},
        created_at="2026-06-25T00:00:00Z",
        notes=["hello"],
    )
    text = stringify_manifest(manifest)
    assert text.endswith("\n")
    restored = parse_manifest(text)
    assert restored.network == "testnet"
    assert restored.chain_id == "qorechain-diana"
    assert restored.addresses == {"creator": "qor1creator"}
    assert restored.notes == ["hello"]
    rc = restored.config
    assert rc.rollup_id == "my-rollup"
    assert rc.settlement == config.settlement
    assert rc.proof_system == config.proof_system
    assert rc.stake_amount_uqor == "10000000000"
    assert rc.sequencer_params.sequencer_address == "qor1seq"
    assert rc.sequencer_params.inclusion_delay == 2


def test_from_manifest_yields_builder():
    manifest = to_manifest(_config(), network="testnet")
    builder = from_manifest(manifest)
    rebuilt = builder.build()
    assert rebuilt.rollup_id == "my-rollup"


def test_parse_rejects_foreign_schema():
    with pytest.raises(ValueError):
        parse_manifest('{"schema": "not-ours", "network": "testnet", "config": {}}')
