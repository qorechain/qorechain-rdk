"""Client for the custom ``qor_`` JSON-RPC namespace.

Served at the EVM JSON-RPC endpoint: rollup status, batch status, the
QCAI-assisted profile suggestion, and DA blob status.
"""

from __future__ import annotations

import json
from typing import Any, Optional, Union

from .http import Transport, default_transport


class QorClient:
    """Client for the ``qor_`` JSON-RPC namespace."""

    def __init__(self, url: str, transport: Optional[Transport] = None) -> None:
        self._url = url
        self._transport = transport or default_transport()
        self._id = 0

    def call(self, method: str, params: Optional[list] = None) -> Any:
        """Make a raw ``qor_*`` JSON-RPC call."""
        self._id += 1
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or []}
        )
        resp = self._transport(
            "POST",
            self._url,
            {"content-type": "application/json", "accept": "application/json"},
            payload,
        )
        if not resp.ok:
            raise RuntimeError(
                f"JSON-RPC {method} failed: {resp.status} {resp.status_text}"
            )
        body = resp.json() or {}
        if body.get("error"):
            err = body["error"]
            raise RuntimeError(
                f"JSON-RPC {method} error {err.get('code')}: {err.get('message')}"
            )
        return body.get("result")

    def get_rollup_status(self, rollup_id: str) -> Any:
        """Rollup configuration, status, and settlement mode."""
        return self.call("qor_getRollupStatus", [rollup_id])

    def list_rollups(self) -> Any:
        """All registered rollups with a status summary."""
        return self.call("qor_listRollups", [])

    def get_settlement_batch(self, rollup_id: str, batch_index: Union[int, str]) -> Any:
        """Settlement batch details and finalization status."""
        return self.call("qor_getSettlementBatch", [rollup_id, int(batch_index)])

    def suggest_rollup_profile(self, use_case: str) -> Any:
        """QCAI-assisted rollup profile recommendation for a use-case description."""
        return self.call("qor_suggestRollupProfile", [use_case])

    def get_da_blob_status(self, rollup_id: str, blob_index: Union[int, str]) -> Any:
        """Data-availability blob storage status."""
        return self.call("qor_getDABlobStatus", [rollup_id, int(blob_index)])

    def get_rl_agent_status(self) -> Any:
        """QCAI reinforcement-learning agent status (the fee/routing policy agent)."""
        return self.call("qor_getRLAgentStatus", [])

    def get_rl_observation(self) -> Any:
        """The RL agent's current observation vector (network state it acts on)."""
        return self.call("qor_getRLObservation", [])

    def get_rl_reward(self) -> Any:
        """The RL agent's latest reward signal."""
        return self.call("qor_getRLReward", [])


__all__ = ["QorClient"]
