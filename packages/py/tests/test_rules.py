"""Ported verbatim from the chain's own tests (x/rdk/types/rollup_id_test.go
and msgs_withdrawal_test.go at v3.2.3), so a disagreement here is a
disagreement with the chain, not with a guess."""

import pytest

from qorrdk.rules import (
    MAX_WITHDRAWAL_PROOF_DEPTH,
    ROLLUP_ESCROW_DENOM,
    is_valid_rollup_id,
    rollup_id_error,
    withdrawal_errors,
)

GOOD = ["abc", "a1b", "0rollup", "my-rollup", "my_rollup", "my.rollup", "r--",
        "victim", "a" * 64, "9.9.9"]
BAD = ["", "ab", "a" * 65, "victim/x", "Victim", "ROLL", "-abc", ".abc", "_abc",
       "has space", "tab\tid", "nul\x00id", "new\nline", "é-rollup", "rollup✓",
       "a/b", "a\\b", "a:b", "a+b", "a%2fb"]


@pytest.mark.parametrize("rid", GOOD)
def test_accepts(rid):
    assert rollup_id_error(rid) is None and is_valid_rollup_id(rid)


@pytest.mark.parametrize("rid", BAD)
def test_refuses(rid):
    assert rollup_id_error(rid) is not None and not is_valid_rollup_id(rid)


def test_length_in_bytes():
    assert "3 to 64" in rollup_id_error("a" * 63 + "é")


ADDR = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h"
SIB = "ab" * 32


def _good(**over):
    w = dict(submitter=ADDR, rollup_id="roll-1", recipient=ADDR,
             denom=ROLLUP_ESCROW_DENOM, amount=1, proof=[SIB, SIB])
    w.update(over)
    return w


def test_good_withdrawal():
    assert withdrawal_errors(**_good()) == []


@pytest.mark.parametrize("over", [
    {"submitter": "nope"}, {"rollup_id": ""}, {"recipient": "nope"},
    {"denom": "uatom"}, {"amount": 0}, {"amount": -5},
    {"proof": ["010203"]}, {"proof": [SIB] * (MAX_WITHDRAWAL_PROOF_DEPTH + 1)},
])
def test_refused_withdrawal(over):
    assert withdrawal_errors(**_good(**over))


def test_max_depth_accepted():
    assert withdrawal_errors(**_good(proof=[SIB] * MAX_WITHDRAWAL_PROOF_DEPTH)) == []


def test_old_id_not_held_to_new_grammar():
    assert withdrawal_errors(**_good(rollup_id="Legacy/ID")) == []
