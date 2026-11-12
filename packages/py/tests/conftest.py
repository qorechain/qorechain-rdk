"""Shared fixtures: the golden fixtures generated from the TS reference, and the
chain v3.2.8 vectors (``v328.json``, a copy of ``packages/_fixtures/v328.json``)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

_GOLDEN_PATH = Path(__file__).parent / "golden.json"
_V328_PATH = Path(__file__).parent / "v328.json"


@pytest.fixture(scope="session")
def golden() -> dict:
    return json.loads(_GOLDEN_PATH.read_text())


@pytest.fixture(scope="session")
def v328() -> dict:
    """Chain v3.2.8 vectors, produced from the chain's own definitions."""
    return json.loads(_V328_PATH.read_text())
