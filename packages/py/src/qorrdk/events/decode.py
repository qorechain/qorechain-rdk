"""Decode ``rdk`` module events from a transaction result.

The decoders filter a transaction's events down to the ``rdk`` ones and expose
their attributes as a plain map.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

#: The event types emitted by the ``rdk`` module.
RDK_EVENT_TYPES: tuple[str, ...] = (
    "rollup_created",
    "rollup_paused",
    "rollup_resumed",
    "rollup_stopped",
    "batch_submitted",
    "batch_challenged",
    "batch_finalized",
    "batch_rejected",
    "da_blob_stored",
    "da_blob_pruned",
    "profile_suggested",
)


@dataclass
class RawEvent:
    """A minimal Cosmos event shape."""

    type: str
    attributes: Sequence[dict]


@dataclass
class DecodedRdkEvent:
    """A decoded ``rdk`` event with its attributes as a map."""

    type: str
    attributes: dict[str, str]


def _as_raw_event(event) -> RawEvent:
    if isinstance(event, RawEvent):
        return event
    return RawEvent(type=event.get("type", ""), attributes=event.get("attributes", []))


def decode_rdk_events(events: Sequence) -> list[DecodedRdkEvent]:
    """Filter and decode the ``rdk`` events from a list of transaction events."""
    out: list[DecodedRdkEvent] = []
    for event in events:
        ev = _as_raw_event(event)
        if ev.type not in RDK_EVENT_TYPES:
            continue
        attributes: dict[str, str] = {}
        for attr in ev.attributes:
            key = attr.get("key") if isinstance(attr, dict) else attr.key
            value = attr.get("value") if isinstance(attr, dict) else attr.value
            attributes[str(key)] = str(value)
        out.append(DecodedRdkEvent(type=ev.type, attributes=attributes))
    return out


def find_rdk_event(events: Sequence, event_type: str) -> Optional[DecodedRdkEvent]:
    """Return the first decoded ``rdk`` event of a given type, if present."""
    for event in decode_rdk_events(events):
        if event.type == event_type:
            return event
    return None


__all__ = [
    "RDK_EVENT_TYPES",
    "RawEvent",
    "DecodedRdkEvent",
    "decode_rdk_events",
    "find_rdk_event",
]
