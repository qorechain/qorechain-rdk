"""Shared fixtures: the golden fixtures generated from the TS reference."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

_GOLDEN_PATH = Path(__file__).parent / "golden.json"


@pytest.fixture(scope="session")
def golden() -> dict:
    return json.loads(_GOLDEN_PATH.read_text())
