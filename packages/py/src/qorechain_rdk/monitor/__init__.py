"""Live monitoring helpers built on the read surface: poll a rollup's health on
an interval, and decode the ``rdk`` events emitted by a transaction.

Mirrors the TS ``monitor`` module with idiomatic Python: :func:`watch_rollup`
runs the poll loop on a background daemon thread and returns a :class:`Watcher`
handle whose :meth:`Watcher.stop` ends it (a :class:`threading.Event` can also be
passed in to coordinate the stop).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable, Optional

from ..events.decode import DecodedRdkEvent, decode_rdk_events
from ..health import RollupHealth, get_rollup_health


def events_from_tx_hash(client, tx_hash: str) -> list[DecodedRdkEvent]:
    """Decode the ``rdk`` events emitted by a transaction, by hash.

    Reads the transaction via ``client.rest.get_tx`` and decodes the ``rdk``
    events from its ``tx_response``.
    """
    body = client.rest.get_tx(tx_hash)
    tx_response = body.get("tx_response", body.get("txResponse", {})) or {}
    events = tx_response.get("events", [])
    if not isinstance(events, list):
        events = []
    return decode_rdk_events(events)


@dataclass
class Watcher:
    """A handle over a running :func:`watch_rollup` loop."""

    _stop_event: threading.Event
    _thread: threading.Thread

    def stop(self) -> None:
        """Stop polling. Safe to call more than once."""
        self._stop_event.set()

    def join(self, timeout: Optional[float] = None) -> None:
        """Wait for the polling thread to finish (after :meth:`stop`)."""
        self._thread.join(timeout)


def watch_rollup(
    client,
    rollup_id: str,
    on_update: Callable[[RollupHealth], None],
    *,
    interval_secs: float = 5.0,
    on_error: Optional[Callable[[BaseException], None]] = None,
    stop_event: Optional[threading.Event] = None,
    now_secs: Optional[Callable[[], int]] = None,
) -> Watcher:
    """Poll a rollup's :class:`RollupHealth` on an interval.

    ``on_update`` is invoked with each health snapshot; ``on_error`` (if given)
    is invoked on a polling error and the loop continues. Polling runs on a
    background daemon thread; the returned :class:`Watcher` (or the optional
    ``stop_event``) stops it. Returns immediately after the first tick is
    scheduled.
    """
    stop = stop_event if stop_event is not None else threading.Event()

    def _loop() -> None:
        while not stop.is_set():
            try:
                health = get_rollup_health(
                    client,
                    rollup_id,
                    now_secs=now_secs() if now_secs is not None else None,
                )
                if not stop.is_set():
                    on_update(health)
            except BaseException as error:  # noqa: BLE001
                if not stop.is_set() and on_error is not None:
                    on_error(error)
            # Wait returns True if the event was set during the interval.
            if stop.wait(interval_secs):
                break

    thread = threading.Thread(target=_loop, name=f"watch-rollup-{rollup_id}", daemon=True)
    thread.start()
    return Watcher(_stop_event=stop, _thread=thread)


__all__ = ["Watcher", "events_from_tx_hash", "watch_rollup"]
