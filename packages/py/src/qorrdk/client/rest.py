"""Typed read client over the ``rdk`` REST (LCD) routes.

This is the gRPC-gateway HTTP surface, so it mirrors the gRPC query service
one-to-one.
"""

from __future__ import annotations

from typing import Any, Optional, Union
from urllib.parse import quote, urlencode

from .http import Transport, default_transport
from .views import (
    AnchorView,
    BatchView,
    InboxView,
    KemKeyView,
    ParamsView,
    PostedDataView,
    PqcAccountView,
    RawRecord,
    RollupView,
    SubmitterBondView,
    map_anchor_view,
    map_batch_view,
    map_inbox_view,
    map_kem_key_view,
    map_params_view,
    map_posted_data_view,
    map_pqc_account_view,
    map_rollup_view,
    map_submitter_bond_view,
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

    def list_batches_page(
        self,
        rollup_id: str,
        start_index: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> tuple[list[BatchView], int]:
        """One page of a rollup's batches, in index order, from ``start_index``.

        The chain returns at most ``limit`` (default 50, capped at 100) and a
        ``next_index`` that is ``0`` when there is no further page.
        """
        params = {}
        if start_index is not None:
            params["start_index"] = str(start_index)
        if limit is not None:
            params["limit"] = str(limit)
        qs = ("?" + urlencode(params)) if params else ""
        body = self._get(f"/qorechain/rdk/v1/batches/{quote(rollup_id, safe='')}{qs}")
        batches = [map_batch_view(b) for b in _as_array(body.get("batches"))]
        return batches, int(body.get("next_index") or body.get("nextIndex") or 0)

    def list_batches(self, rollup_id: str, start_index: Optional[int] = None) -> list[BatchView]:
        """All settlement batches for a rollup, following every page.

        The chain's ``Batches`` query is paged (50 per page by default).
        Releases before 0.6.0 read only the first page, so nothing past batch
        #49 was ever returned.
        """
        out: list[BatchView] = []
        start = start_index
        for _ in range(100_000):  # bounded against a misbehaving node
            page, next_index = self.list_batches_page(rollup_id, start, 100)
            out.extend(page)
            if next_index == 0 or not page:
                break
            start = next_index
        return out

    def get_latest_batch(self, rollup_id: str) -> BatchView:
        """The latest settlement batch for a rollup (the chain's ``LatestBatch``).

        Releases before 0.6.0 requested ``/batches/{id}?latest=true``, which is
        not a chain route: the node returned the first page of the list, which
        was then read as one empty batch -- so health reported "no batches yet"
        for every rollup.
        """
        body = self._get(f"/qorechain/rdk/v1/latest_batch/{quote(rollup_id, safe='')}")
        return map_batch_view(_as_record(body.get("batch", body)))

    def get_protocol_features(self) -> list:
        """The chain's protocol switches (``/qorechain/pqc/v1/protocol_features``)
        as ``[{"name": str, "enabled": bool}, ...]``. Chains before the route
        existed answer 404 or 501, which this raises; see
        :meth:`is_protocol_feature_enabled`."""
        body = self._get("/qorechain/pqc/v1/protocol_features")
        features = body.get("features") if isinstance(body.get("features"), list) else []
        return [
            {"name": str(f.get("name", "")), "enabled": f.get("enabled") is True}
            for f in features
            if isinstance(f, dict)
        ]

    def is_protocol_feature_enabled(self, name: str) -> bool:
        """Whether the chain reports feature ``name`` as enabled. A chain that
        does not serve the feature route has none of its features, so an
        unavailable route (404/501) reads as ``False``; other errors raise."""
        try:
            return any(f["name"] == name and f["enabled"] for f in self.get_protocol_features())
        except RuntimeError as err:
            if " failed: 404" in str(err) or " failed: 501" in str(err):
                return False
            raise

    def get_applied_plan_height(self, name: str) -> int:
        """The height at which upgrade plan ``name`` was applied on this chain
        (``/cosmos/upgrade/v1beta1/applied_plan/{name}``), or 0 if it has not been."""
        body = self._get(f"/cosmos/upgrade/v1beta1/applied_plan/{quote(name, safe='')}")
        try:
            height = int(body.get("height") or 0)
        except (TypeError, ValueError):
            return 0
        return max(height, 0)

    def get_inbox(self, rollup_id: str, inbox_end: Union[int, str] = 0) -> InboxView:
        """A rollup's inbox (chain v3.2.8+): head, consumed position, and the
        ``data_hash`` a based batch ending at ``inbox_end`` must carry (0 = the
        head)."""
        q = f"?inbox_end={int(inbox_end)}" if int(inbox_end) > 0 else ""
        body = self._get(f"/qorechain/rdk/v1/inbox/{quote(rollup_id, safe='')}{q}")
        return map_inbox_view(_as_record(body.get("inbox", body)))

    def get_posted_data(self, rollup_id: str, sequence: Union[int, str]) -> PostedDataView:
        """One posted-data commitment (chain v3.2.8+). The payload is in the
        transaction at ``height``."""
        body = self._get(
            f"/qorechain/rdk/v1/posted_data/{quote(rollup_id, safe='')}/{sequence}"
        )
        raw = body.get("posted_data", body.get("postedData", body))
        return map_posted_data_view(_as_record(raw))

    def get_submitter_bond(self, rollup_id: str, submitter: str) -> SubmitterBondView:
        """A submitter's bond on a qledger-v1 rollup and when it unlocks (chain v3.2.8+)."""
        body = self._get(
            f"/qorechain/rdk/v1/submitter_bond/{quote(rollup_id, safe='')}"
            f"/{quote(submitter, safe='')}"
        )
        return map_submitter_bond_view(body)

    def get_kem_key(self, address: str) -> Optional[KemKeyView]:
        """The key-encapsulation key ``address`` published (chain v3.2.5+), or
        ``None`` when it has none."""
        body = self._get(f"/qorechain/pqc/v1/kem/{quote(address, safe='')}")
        if body.get("found") is not True:
            return None
        return map_kem_key_view(_as_record(body.get("key")))

    def get_private_rollup_recipients(self, rollup_id: str) -> tuple[int, list[tuple[str, str]]]:
        """The recipients a post on private rollup ``rollup_id`` must be sealed
        to: ``(members_epoch, [(member, encapsulation_key_hex), ...])`` with the
        members in order, each with its registered ML-KEM-1024 key. Raises if
        the rollup is not private, has no members, or a member has no such key
        (the chain would refuse any envelope)."""
        rollup = self.get_rollup(rollup_id)
        if rollup.privacy != "encapsulated":
            raise ValueError(f"rollup {rollup_id} is not private")
        if not rollup.members:
            raise ValueError(f"rollup {rollup_id} has no members yet")
        recipients: list[tuple[str, str]] = []
        for member in rollup.members:
            key = self.get_kem_key(member)
            if key is None or key.algorithm_id != 2:
                raise ValueError(f"member {member} has no ML-KEM-1024 key registered")
            recipients.append((member, key.public_key))
        return rollup.members_epoch, recipients

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
            f"/qorechain/pqc/v1/account/{quote(address, safe='')}"
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

    def get_latest_height(self) -> int:
        """The node's latest block height (``/cosmos/base/node/v1beta1/status``)."""
        body = self._get("/cosmos/base/node/v1beta1/status")
        try:
            height = int(body.get("height") or 0)
        except (TypeError, ValueError):
            height = 0
        if height <= 0:
            raise RuntimeError("the node did not report its height")
        return height

    def search_txs(
        self, query: str, page_limit: int = 100, max_pages: int = 50
    ) -> list[RawRecord]:
        """Every transaction matching an event query (for example
        ``rdk_data_posted.rollup_id='my-rollup'``), as raw ``tx_responses``,
        oldest first. Needs a node with transaction indexing on."""
        out: list[RawRecord] = []
        for page in range(1, max_pages + 1):
            body = self._get(
                f"/cosmos/tx/v1beta1/txs?query={quote(query, safe='')}"
                f"&page={page}&limit={page_limit}&order_by=ORDER_BY_ASC"
            )
            txs = _as_array(body.get("tx_responses"))
            out.extend(txs)
            try:
                total = int(body.get("total") or 0)
            except (TypeError, ValueError):
                total = 0
            if len(txs) < page_limit or (total > 0 and len(out) >= total):
                break
        return out


__all__ = ["RestClient"]
