"""Lifecycle, events, DA, faucet, preflight, and health."""

from __future__ import annotations

import pytest

from qorrdk import (
    BatchStatus,
    RollupStatus,
    assert_da_backend_available,
    assert_rollup_action,
    build_da_blob,
    can_perform_rollup_action,
    check_preflight,
    decode_rdk_events,
    find_rdk_event,
    get_rollup_health,
    is_batch_final,
    is_challenge_window_closed,
    is_da_backend_available,
    presets,
    request_faucet,
)
from qorrdk.client.http import HttpResponse
from qorrdk.enums import DABackend


# ---- lifecycle ----------------------------------------------------------- #

def test_rollup_actions():
    assert can_perform_rollup_action("pause", RollupStatus.ACTIVE)
    assert not can_perform_rollup_action("pause", RollupStatus.PAUSED)
    assert can_perform_rollup_action("resume", RollupStatus.PAUSED)
    assert can_perform_rollup_action("stop", RollupStatus.ACTIVE)
    assert can_perform_rollup_action("stop", RollupStatus.PAUSED)


def test_assert_rollup_action_raises():
    with pytest.raises(ValueError):
        assert_rollup_action("pause", RollupStatus.STOPPED)


def test_batch_final_and_window():
    assert is_batch_final(BatchStatus.FINALIZED)
    assert is_batch_final(BatchStatus.REJECTED)
    assert not is_batch_final(BatchStatus.SUBMITTED)
    assert is_challenge_window_closed(100, 50, 150)
    assert not is_challenge_window_closed(100, 50, 149)


# ---- events -------------------------------------------------------------- #

def test_decode_rdk_events():
    events = [
        {"type": "rollup_created", "attributes": [{"key": "rollup_id", "value": "r1"}]},
        {"type": "transfer", "attributes": [{"key": "amount", "value": "1uqor"}]},
        {"type": "batch_finalized", "attributes": [{"key": "batch_index", "value": "3"}]},
    ]
    decoded = decode_rdk_events(events)
    assert [e.type for e in decoded] == ["rollup_created", "batch_finalized"]
    assert decoded[0].attributes["rollup_id"] == "r1"
    found = find_rdk_event(events, "batch_finalized")
    assert found is not None and found.attributes["batch_index"] == "3"
    assert find_rdk_event(events, "rollup_paused") is None


# ---- DA ------------------------------------------------------------------ #

def test_build_da_blob():
    blob = build_da_blob(b"hello")
    assert blob.size == 5
    assert blob.data_hash.startswith("0x")
    assert len(blob.data_hash) == 66


def test_da_blob_size_limit():
    with pytest.raises(ValueError):
        build_da_blob(b"toolong", max_blob_size=3)


def test_da_backend_availability():
    assert is_da_backend_available(DABackend.NATIVE)
    assert not is_da_backend_available(DABackend.CELESTIA)
    assert_da_backend_available(DABackend.NATIVE)
    with pytest.raises(ValueError):
        assert_da_backend_available(DABackend.CELESTIA)


# ---- faucet -------------------------------------------------------------- #

def test_faucet_requires_url():
    with pytest.raises(ValueError):
        request_faucet("qor1abc", url=None)


def test_faucet_posts():
    class FaucetTransport:
        def __call__(self, method, url, headers=None, body=None):
            return HttpResponse(200, "OK", '{"ok": true}')

    result = request_faucet("qor1abc", url="http://faucet", transport=FaucetTransport())
    assert result.ok
    assert result.status == 200


# ---- preflight / health (mocked client) ---------------------------------- #

class _FakeRest:
    def __init__(self, rollup_status="active", balance="20000000000", latest=None):
        self._rollup_status = rollup_status
        self._balance = balance
        self._latest = latest

    def get_balance(self, address, denom="uqor"):
        return self._balance

    def get_rollup(self, rollup_id):
        from qorrdk import map_rollup_view

        return map_rollup_view({"rollup_id": rollup_id, "status": self._rollup_status})

    def get_latest_batch(self, rollup_id):
        if self._latest is None:
            raise RuntimeError("no batch")
        from qorrdk import map_batch_view

        return map_batch_view(self._latest)


class _FakeNetwork:
    name = "testnet"
    chain_id = "qorechain-diana"

    class endpoints:
        rest = "http://localhost:1317"


class _FakeClient:
    def __init__(self, rest, params):
        self.rest = rest
        self.network = _FakeNetwork()
        self._params = params

    def params(self):
        from qorrdk import map_params_view

        return map_params_view(self._params)


_PARAMS = {
    "max_rollups": 100,
    "min_stake_for_rollup": "10000000000",
    "rollup_creation_burn_rate": "0.01",
    "default_challenge_window": 604800,
    "max_da_blob_size": 2097152,
    "blob_retention_blocks": 432000,
    "max_batches_per_block": 10,
}


def test_preflight_all_ok():
    client = _FakeClient(_FakeRest(balance="20000000000"), _PARAMS)
    result = check_preflight(
        client,
        config=presets.defi("roll-r").build(),
        signer_address="qor1abc",
        expected_network="testnet",
    )
    assert result.ok
    ids = {c.id for c in result.checks}
    assert {"rest", "params", "network", "config", "signer", "balance"} <= ids


def test_preflight_insufficient_balance_fails():
    client = _FakeClient(_FakeRest(balance="1"), _PARAMS)
    result = check_preflight(client, signer_address="qor1abc")
    assert not result.ok
    balance_check = next(c for c in result.checks if c.id == "balance")
    assert balance_check.status == "fail"


def test_health_active_with_batch():
    # submitted_at is a BLOCK HEIGHT. This test used to read it as a Unix
    # timestamp (age 500 s, deadline 1000 + 604800) -- encoding the bug.
    from qorrdk.lifecycle.state_machine import ChainTip

    latest = {"rollup_id": "r1", "batch_index": 2, "status": "submitted", "submitted_at": 1000}
    client = _FakeClient(_FakeRest(rollup_status="active", latest=latest), _PARAMS)
    health = get_rollup_health(client, "r1", tip=ChainTip(height=1500, time_secs=9_999_999))
    assert health.status == "active"
    assert health.has_batches
    assert health.latest_batch_index == 2
    assert health.batch_age_blocks == 500
    assert health.batch_age_secs is None  # no submission time recorded
    w = health.challenge_window
    assert w.mode == "blocks"
    assert w.window_blocks == 604800 // 6
    assert w.deadline_height == 1000 + 100800
    assert w.blocks_remaining == 1000 + 100800 - 1500
    assert w.open and not w.finalizable


def test_health_time_window_when_submission_time_recorded():
    from qorrdk.lifecycle.state_machine import ChainTip

    latest = {
        "rollup_id": "r1", "batch_index": 3, "status": "submitted",
        "submitted_at": 2000, "submitted_time": 1_700_000_000,
    }
    client = _FakeClient(_FakeRest(rollup_status="active", latest=latest), _PARAMS)
    health = get_rollup_health(client, "r1", tip=ChainTip(height=2100, time_secs=1_700_000_100))
    assert health.batch_age_secs == 100
    assert health.challenge_window.mode == "time"
    assert health.challenge_deadline_secs == 1_700_000_000 + 604800
    assert health.seconds_until_challenge_deadline == 604800 - 100


def test_batch_challenge_window_matches_the_chain_boundaries():
    """At exactly window_blocks a batch is finalizable AND still challengeable."""
    from qorrdk.lifecycle.state_machine import ChainTip, batch_challenge_window

    w = batch_challenge_window(1000, 0, 600, ChainTip(height=1100, time_secs=0))  # 100 blocks
    assert w.finalizable and w.open
    w = batch_challenge_window(1000, 0, 600, ChainTip(height=1101, time_secs=0))
    assert w.finalizable and not w.open


def test_health_no_batches():
    client = _FakeClient(_FakeRest(rollup_status="active", latest=None), _PARAMS)
    health = get_rollup_health(client, "r1", now_secs=1500)
    assert not health.has_batches
    assert any("no settlement batches" in n for n in health.notes)


class _InOrderRest(_FakeRest):
    """A chain on v3.2.5 whose latest batch waits behind an earlier one."""

    def __init__(self, latest, batches, settlement_enabled):
        super().__init__(rollup_status="active", latest=latest)
        self._batches = batches
        self._settlement_enabled = settlement_enabled
        self.list_calls: list = []

    def is_protocol_feature_enabled(self, name):
        return name == "rdk-challenge-settlement" and self._settlement_enabled

    def list_batches(self, rollup_id, start_index=None):
        from qorrdk import map_batch_view

        self.list_calls.append(start_index)
        return [map_batch_view(b) for b in self._batches]


def _in_order_chain(settlement_enabled):
    def batch(i, status):
        return {"rollup_id": "r1", "batch_index": i, "status": status, "submitted_at": 900 + i}

    latest = {"rollup_id": "r1", "batch_index": 2, "status": "submitted", "submitted_at": 1000}
    batches = [batch(0, "challenged"), batch(1, "submitted"), latest]
    return _InOrderRest(latest, batches, settlement_enabled)


def test_health_latest_batch_held_back_by_an_earlier_challenged_batch():
    from qorrdk.lifecycle.state_machine import ChainTip

    rest = _in_order_chain(settlement_enabled=True)
    client = _FakeClient(rest, _PARAMS)
    # A 600 s window is 100 blocks: at height 1200 batch 2's own window has passed.
    health = get_rollup_health(
        client, "r1", tip=ChainTip(height=1200, time_secs=0), challenge_window_secs=600
    )
    assert health.challenge_window.finalizable
    assert health.held_back_by is not None
    assert health.held_back_by.batch_index == 0
    assert health.held_back_by.status == "challenged"
    assert rest.list_calls == [0]  # max(0, 2 - 4096)
    assert any(
        "batches finalize in order and batch 0 is still challenged" in n for n in health.notes
    )


def test_health_not_held_back_when_in_order_settlement_is_off():
    from qorrdk.lifecycle.state_machine import ChainTip

    rest = _in_order_chain(settlement_enabled=False)
    client = _FakeClient(rest, _PARAMS)
    health = get_rollup_health(
        client, "r1", tip=ChainTip(height=1200, time_secs=0), challenge_window_secs=600
    )
    assert health.challenge_window.finalizable
    assert health.held_back_by is None
    assert rest.list_calls == []
    assert not any("finalize in order" in n for n in health.notes)
