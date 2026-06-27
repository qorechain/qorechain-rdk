"""Typed read client over the ``rdk`` REST (LCD) routes.

This is the gRPC-gateway HTTP surface, so it mirrors the gRPC query service
one-to-one.
"""

from __future__ import annotations

from typing import Any, Optional, Union
from urllib.parse import quote

from .http import Transport, default_transport
from .views import (
    AnchorView,
    BatchView,
    ParamsView,
    PqcAccountView,
    RawRecord,
    RollupView,
    map_anchor_view,
    map_batch_view,
    map_params_view,
    map_pqc_account_view,
    map_rollup_view,
)


def _as_record(value: Any) -> RawRecord:
    return value if isinstance(value, dict) else {}


def _as_array(value: Any) -> list[RawRecord]:
    return value if isinstance(value, list) else []


class RestClient:
    """Read client over the documented ``rdk`` REST routes."""

    def __init__(
        self, base_url: str, transport: Optional[Transport] = None
    ) -> None:
        self._base = base_url.rstrip("/")
        self._transport = transport or default_transport()

    def _get(self, path: str) -> RawRecord:
        resp = self._transport(
            "GET", f"{self._base}{path}", {"accept": "application/json"}, None
        )
        if not resp.ok:
            raise RuntimeError(
                f"REST GET {path} failed: {resp.status} {resp.status_text}"
            )
        return _as_record(resp.json())

    def get_params(self) -> ParamsView:
        """Live module parameters."""
        body = self._get("/qorechain/rdk/v1/params")
        return map_params_view(_as_record(body.get("params", body)))

    def get_rollup(self, rollup_id: str) -> RollupView:
        """A single rollup's configuration and status."""
        body = self._get(f"/qorechain/rdk/v1/rollup/{quote(rollup_id, safe='')}")
        return map_rollup_view(_as_record(body.get("rollup", body)))

    def list_rollups(self) -> list[RollupView]:
        """All registered rollups."""
        body = self._get("/qorechain/rdk/v1/rollups")
        return [map_rollup_view(r) for r in _as_array(body.get("rollups"))]

    def get_batch(self, rollup_id: str, batch_index: Union[int, str]) -> BatchView:
        """A settlement batch by index."""
        body = self._get(
            f"/qorechain/rdk/v1/batch/{quote(rollup_id, safe='')}/{batch_index}"
        )
        return map_batch_view(_as_record(body.get("batch", body)))

    def list_batches(self, rollup_id: str) -> list[BatchView]:
        """All settlement batches for a rollup."""
        body = self._get(f"/qorechain/rdk/v1/batches/{quote(rollup_id, safe='')}")
        return [map_batch_view(b) for b in _as_array(body.get("batches"))]

    def get_latest_batch(self, rollup_id: str) -> BatchView:
        """The latest settlement batch for a rollup."""
        body = self._get(
            f"/qorechain/rdk/v1/batches/{quote(rollup_id, safe='')}?latest=true"
        )
        return map_batch_view(_as_record(body.get("batch", body)))

    def get_blob(self, rollup_id: str, blob_index: Union[int, str]) -> RawRecord:
        """Raw data-availability blob details (status, size, expiry)."""
        return self._get(
            f"/qorechain/rdk/v1/blob/{quote(rollup_id, safe='')}/{blob_index}"
        )

    def get_anchor(self, layer_id: str) -> AnchorView:
        """The latest state anchor a layer committed to the Main Chain.

        The ``x/multilayer`` Anchor query. ``layer_id`` is the rollup's
        ``layer_id``.
        """
        body = self._get(
            f"/qorechain/multilayer/v1/anchor/{quote(layer_id, safe='')}"
        )
        return map_anchor_view(_as_record(body.get("anchor", body)))

    def get_latest_anchor(self, layer_id: str) -> AnchorView:
        """Alias for :meth:`get_anchor` — the chain's Anchor query returns the latest."""
        return self.get_anchor(layer_id)

    def get_anchors(self, layer_id: str) -> list[AnchorView]:
        """All state anchors a layer has committed (newest first)."""
        body = self._get(
            f"/qorechain/multilayer/v1/anchors/{quote(layer_id, safe='')}"
        )
        return [map_anchor_view(a) for a in _as_array(body.get("anchors"))]

    def get_pqc_account(self, address: str) -> PqcAccountView:
        """An account's post-quantum key record (the ``x/pqc`` account query).

        The ``public_key`` is the registered ML-DSA-87 (Dilithium-5)
        verification key.
        """
        body = self._get(
            f"/qorechain/pqc/v1/accounts/{quote(address, safe='')}"
        )
        return map_pqc_account_view(_as_record(body.get("account", body)))

    # --- QCAI advisory reads (the ``ai`` REST surface) ---

    def get_fee_estimate(self, urgency: Optional[str] = None) -> RawRecord:
        """QCAI fee estimate; ``urgency`` is one of ``low`` | ``normal`` | ``high``."""
        q = f"?urgency={quote(urgency, safe='')}" if urgency else ""
        return self._get(f"/qorechain/ai/v1/fee-estimate{q}")

    def get_network_recommendations(self) -> RawRecord:
        """QCAI network recommendations (congestion, suggested settings)."""
        return self._get("/qorechain/ai/v1/network/recommendations")

    def get_fraud_investigations(self) -> list[RawRecord]:
        """Open fraud investigations across the network."""
        body = self._get("/qorechain/ai/v1/fraud/investigations")
        for key in ("investigations", "data"):
            if isinstance(body.get(key), list):
                return body[key]
        return _as_array(body)

    def get_fraud_investigation(self, investigation_id: str) -> RawRecord:
        """A single fraud investigation by id."""
        return self._get(
            f"/qorechain/ai/v1/fraud/investigations/{quote(investigation_id, safe='')}"
        )

    def get_circuit_breakers(self) -> RawRecord:
        """Active QCAI circuit breakers (network safety throttles)."""
        return self._get("/qorechain/ai/v1/circuit-breakers")

    def get_balance(self, address: str, denom: str = "uqor") -> str:
        """An account's balance for a single denom (default ``uqor``)."""
        body = self._get(
            f"/cosmos/bank/v1beta1/balances/{quote(address, safe='')}"
            f"/by_denom?denom={quote(denom, safe='')}"
        )
        balance = _as_record(body.get("balance"))
        amount = balance.get("amount")
        return amount if isinstance(amount, str) else str(amount if amount is not None else "0")

    def get_all_balances(self, address: str) -> list[dict[str, str]]:
        """All of an account's balances as ``{denom, amount}`` records."""
        body = self._get(f"/cosmos/bank/v1beta1/balances/{quote(address, safe='')}")
        return [
            {"denom": str(c.get("denom", "")), "amount": str(c.get("amount", "0"))}
            for c in _as_array(body.get("balances"))
        ]

    def get_tx(self, tx_hash: str) -> RawRecord:
        """A transaction by hash (the raw ``/cosmos/tx/v1beta1/txs/{hash}`` response)."""
        return self._get(f"/cosmos/tx/v1beta1/txs/{quote(tx_hash, safe='')}")


__all__ = ["RestClient"]
