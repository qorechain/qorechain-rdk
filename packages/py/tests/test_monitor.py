"""The monitor surface: decode events from a tx hash, and watch a rollup's health."""

from __future__ import annotations

import threading

from qorrdk import (
    RollupHealth,
    Watcher,
    events_from_tx_hash,
    watch_rollup,
)


class _FakeRest:
    def __init__(self, tx_body):
        self._tx_body = tx_body

    def get_tx(self, tx_hash):
        self._last_hash = tx_hash
        return self._tx_body


class _FakeClient:
    def __init__(self, rest):
        self.rest = rest


def test_events_from_tx_hash_decodes_rdk_event():
    tx_body = {
        "tx_response": {
            "txhash": "ABC123",
            "events": [
                {
                    "type": "rollup_created",
                    "attributes": [
                        {"key": "rollup_id", "value": "my-rollup"},
                        {"key": "creator", "value": "qor1creator"},
                    ],
                },
                # A non-rdk event is filtered out.
                {"type": "message", "attributes": [{"key": "action", "value": "x"}]},
            ],
        }
    }
    client = _FakeClient(_FakeRest(tx_body))
    decoded = events_from_tx_hash(client, "ABC123")
    assert client.rest._last_hash == "ABC123"
    assert len(decoded) == 1
    assert decoded[0].type == "rollup_created"
    assert decoded[0].attributes == {"rollup_id": "my-rollup", "creator": "qor1creator"}


def test_events_from_tx_hash_handles_missing_events():
    client = _FakeClient(_FakeRest({"tx_response": {}}))
    assert events_from_tx_hash(client, "NONE") == []


def test_watch_rollup_single_tick_then_stop():
    """A mocked health source: on_update fires, then the watcher stops cleanly."""

    health = RollupHealth(
        rollup_id="r1", status="active", has_batches=False, healthy=True
    )
    seen: list[RollupHealth] = []
    fired = threading.Event()

    def fake_get_rollup_health(client, rollup_id, now_secs=None):
        return health

    # Patch the symbol used inside the monitor module.
    import qorrdk.monitor as monitor

    original = monitor.get_rollup_health
    monitor.get_rollup_health = fake_get_rollup_health
    try:

        def on_update(h):
            seen.append(h)
            fired.set()

        watcher = watch_rollup(
            client=object(),
            rollup_id="r1",
            on_update=on_update,
            interval_secs=0.01,
        )
        assert isinstance(watcher, Watcher)
        # Wait for at least the first tick.
        assert fired.wait(2.0), "on_update was not called"
        watcher.stop()
        watcher.join(2.0)
    finally:
        monitor.get_rollup_health = original

    assert len(seen) >= 1
    assert seen[0].rollup_id == "r1"
    assert seen[0].status == "active"


def test_watch_rollup_reports_errors_and_continues():
    fired = threading.Event()
    errors: list[BaseException] = []

    def boom(client, rollup_id, now_secs=None):
        raise RuntimeError("node down")

    import qorrdk.monitor as monitor

    original = monitor.get_rollup_health
    monitor.get_rollup_health = boom
    try:

        def on_error(err):
            errors.append(err)
            fired.set()

        watcher = watch_rollup(
            client=object(),
            rollup_id="r1",
            on_update=lambda h: None,
            interval_secs=0.01,
            on_error=on_error,
        )
        assert fired.wait(2.0), "on_error was not called"
        watcher.stop()
        watcher.join(2.0)
    finally:
        monitor.get_rollup_health = original

    assert any(isinstance(e, RuntimeError) for e in errors)
