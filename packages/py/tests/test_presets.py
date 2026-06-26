"""Each preset must equal the golden preset defaults."""

from __future__ import annotations

import pytest

from qorrdk import presets
from qorrdk.presets import PRESET_DEFAULTS

_BUILDERS = {
    "defi": presets.defi,
    "gaming": presets.gaming,
    "nft": presets.nft,
    "enterprise": presets.enterprise,
    "custom": presets.custom,
}

# Maps golden camelCase keys to RollupConfig snake_case attributes.
_FIELD_MAP = {
    "profile": "profile",
    "settlement": "settlement",
    "sequencer": "sequencer",
    "da": "da",
    "proofSystem": "proof_system",
    "gasModel": "gas_model",
    "vmType": "vm_type",
    "blockTimeMs": "block_time_ms",
    "maxTxPerBlock": "max_tx_per_block",
    "challengeWindowSecs": "challenge_window_secs",
    "challengeBondUqor": "challenge_bond_uqor",
}


@pytest.mark.parametrize("name", ["defi", "gaming", "nft", "enterprise", "custom"])
def test_preset_matches_golden(golden, name):
    expected = golden["presetDefaults"][name]
    config = _BUILDERS[name]("r").get()
    for wire, attr in _FIELD_MAP.items():
        if wire not in expected:
            # The optional optimistic fields should be absent for these presets.
            assert getattr(config, attr) is None, f"{name}.{attr} should be unset"
            continue
        actual = getattr(config, attr)
        actual_value = getattr(actual, "value", actual)
        assert actual_value == expected[wire], f"{name}.{attr}"


def test_preset_defaults_keys():
    assert {p.value for p in PRESET_DEFAULTS} == {
        "defi",
        "gaming",
        "nft",
        "enterprise",
        "custom",
    }
