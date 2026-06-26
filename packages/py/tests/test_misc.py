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
        config=presets.defi("r").build(),
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
    latest = {"rollup_id": "r1", "batch_index": 2, "status": "submitted", "submitted_at": 1000}
    client = _FakeClient(_FakeRest(rollup_status="active", latest=latest), _PARAMS)
    health = get_rollup_health(client, "r1", now_secs=1500)
    assert health.status == "active"
    assert health.has_batches
    assert health.latest_batch_index == 2
    assert health.batch_age_secs == 500
    assert health.challenge_deadline_secs == 1000 + 604800


def test_health_no_batches():
    client = _FakeClient(_FakeRest(rollup_status="active", latest=None), _PARAMS)
    health = get_rollup_health(client, "r1", now_secs=1500)
    assert not health.has_batches
    assert any("no settlement batches" in n for n in health.notes)
