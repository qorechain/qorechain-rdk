"""Testnet faucet helper.

The network does not publish a fixed faucet endpoint, so this posts to a URL you
supply (e.g. ``QORE_FAUCET_URL``). It fails with a clear message when no URL is
configured rather than guessing one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional

from ..client.http import Transport, default_transport


@dataclass
class FaucetResult:
    ok: bool
    status: int
    body: Any


def request_faucet(
    address: str,
    url: Optional[str] = None,
    denom: str = "uqor",
    transport: Optional[Transport] = None,
) -> FaucetResult:
    """Request testnet funds from a configured faucet URL."""
    if not url or url.strip() == "":
        raise ValueError(
            "No faucet URL configured. Set a faucet endpoint (e.g. QORE_FAUCET_URL) "
            "or fund the account manually -- see the keys & funding guide."
        )
    transport = transport or default_transport()
    resp = transport(
        "POST",
        url,
        {"content-type": "application/json", "accept": "application/json"},
        json.dumps({"address": address, "denom": denom}),
    )
    try:
        body = resp.json()
    except (ValueError, json.JSONDecodeError):
        body = None
    if not resp.ok:
        raise RuntimeError(f"Faucet request failed: {resp.status} {resp.status_text}")
    return FaucetResult(ok=True, status=resp.status, body=body)


__all__ = ["FaucetResult", "request_faucet"]
