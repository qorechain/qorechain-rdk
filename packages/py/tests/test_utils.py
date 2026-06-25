"""Denom round-trips, golden denom values, and economics."""

from __future__ import annotations

import pytest

from qorechain_rdk import (
    bech32_prefix,
    bech32_to_hex,
    estimate_creation_cost,
    hex_to_bech32,
    mul_decimal_floor,
    qor_to_uqor,
    uqor_to_qor,
)


def test_denom_golden_values(golden):
    d = golden["denom"]
    assert qor_to_uqor("1.5") == d["qorToUqor_1_5"]
    assert uqor_to_qor("10000000000") == d["uqorToQor_1e10"]
    assert qor_to_uqor("0.000001") == d["qorToUqor_0_000001"]


@pytest.mark.parametrize(
    "value", ["0", "1", "1.5", "1000000", "0.000001", "123456.789012"]
)
def test_denom_round_trip(value):
    assert uqor_to_qor(qor_to_uqor(value)) == value


def test_qor_to_uqor_rejects_too_many_fraction_digits():
    with pytest.raises(ValueError):
        qor_to_uqor("1.0000001")


def test_qor_to_uqor_rejects_garbage():
    with pytest.raises(ValueError):
        qor_to_uqor("abc")


def test_uqor_to_qor_rejects_non_integer():
    with pytest.raises(ValueError):
        uqor_to_qor("1.5")


def test_economics_golden(golden):
    e = golden["economics"]
    cost = estimate_creation_cost(e["stakeUqor"], burn_rate=e["burnRate"])
    assert cost.stake_uqor == e["stakeUqor"]
    assert cost.burn_uqor == e["burnUqor"]
    assert cost.net_stake_uqor == e["netStakeUqor"]
    assert cost.total_required_uqor == e["totalRequiredUqor"]
    assert cost.burn_rate == e["burnRate"]


def test_economics_default_burn_rate():
    cost = estimate_creation_cost("10000000000")
    assert cost.burn_rate == "0.01"
    assert cost.burn_uqor == "100000000"


def test_mul_decimal_floor_exact():
    assert mul_decimal_floor(10**10, "0.01") == 100000000
    assert mul_decimal_floor(7, "0.5") == 3  # floors


def test_bech32_round_trip(golden):
    addr = golden["nativeAddress"]
    assert bech32_prefix(addr) == "qor"
    hex_data = bech32_to_hex(addr)
    assert hex_to_bech32(hex_data, "qor") == addr
