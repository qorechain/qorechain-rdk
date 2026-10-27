"""``RdkClient`` -- the high-level entry point.

Resolves a network, composes the REST and ``qor_`` JSON-RPC read clients, exposes
the QCAI-assisted profile suggestion, and connects a signing tx client.
"""

from __future__ import annotations

from typing import Optional

from ..config.networks import NetworkConfig, get_network
from ..enums import ProfileName
from .http import Transport, default_transport
from .jsonrpc import QorClient
from .rest import RestClient
from .views import ParamsView


class RdkClient:
    """The high-level RDK facade over a resolved network."""

    def __init__(
        self,
        network: str = "testnet",
        endpoints: Optional[dict] = None,
        transport: Optional[Transport] = None,
    ) -> None:
        net = get_network(network)
        if endpoints:
            for key, value in endpoints.items():
                if not hasattr(net.endpoints, key):
                    raise ValueError(f'unknown endpoint "{key}"')
                setattr(net.endpoints, key, value)
        #: The resolved network (chain id and endpoints).
        self.network: NetworkConfig = net
        #: REST (LCD) read client.
        self.rest = RestClient(net.endpoints.rest, transport=transport)
        #: ``qor_`` JSON-RPC client.
        self.qor = QorClient(net.endpoints.evm_rpc, transport=transport)
        self._transport = transport

    def params(self) -> ParamsView:
        """Read the live ``rdk`` module parameters from the chain."""
        return self.rest.get_params()

    def get_chain_tip(self) -> "ChainTip":
        """The chain tip -- latest height and its block time -- from the
        consensus RPC's ``/status``.

        A challenge window is judged against this, not the local clock: the
        block-count path counts heights, and the time-based path compares block
        time, which can lag wall time.
        """
        from datetime import datetime

        from ..lifecycle.state_machine import ChainTip

        url = self.network.endpoints.rpc.rstrip("/") + "/status"
        transport = self._transport or default_transport()
        res = transport("GET", url)
        if not res.ok:
            raise RuntimeError(f"could not read the chain tip from {url} (HTTP {res.status})")
        info = ((res.json() or {}).get("result") or {}).get("sync_info") or {}
        height, when = info.get("latest_block_height"), info.get("latest_block_time")
        if height is None or not when:
            raise RuntimeError(f"the node at {url} did not report a latest block height and time")
        # RFC 3339 with nanoseconds and a trailing Z; trim to what fromisoformat takes.
        stamp = when.rstrip("Z")
        if "." in stamp:
            head, frac = stamp.split(".", 1)
            stamp = f"{head}.{frac[:6]}"
        dt = datetime.fromisoformat(stamp + "+00:00")
        return ChainTip(height=int(height), time_secs=int(dt.timestamp()))

    def suggest_profile(
        self, use_case: str, fallback: ProfileName = ProfileName.DEFI
    ):
        """QCAI-assisted profile suggestion, with a documented fallback to ``defi``."""
        from ..profiles import suggest_profile

        return suggest_profile(use_case, self.qor, fallback)

    def connect_tx(
        self,
        signer,
        *,
        pqc_keypair=None,
        include_pqc_public_key: bool = False,
        sign_bytes_version: str = "auto",
    ) -> "RdkTxClient":
        """Connect a signing tx client bound to this network's REST + chain id.

        Pass ``pqc_keypair`` (an ML-DSA-87 keypair, e.g. ``.keypair`` of
        :func:`~qorrdk.accounts.pqc_keypair_from_env`) to sign every transaction
        hybrid (post-quantum); without one the client signs classical-only,
        which both public networks refuse on the native lane.
        ``include_pqc_public_key`` embeds the key so the first transaction
        registers it; ``sign_bytes_version`` is ``"auto"`` (asked of this
        network's REST endpoint), ``"v1"`` or ``"v2"``.
        """
        from ..tx.client import RdkTxClient

        return RdkTxClient(
            rest_url=self.network.endpoints.rest,
            chain_id=self.network.chain_id,
            signer=signer,
            transport=self._transport,
            pqc_keypair=pqc_keypair,
            include_pqc_public_key=include_pqc_public_key,
            sign_bytes_version=sign_bytes_version,
        )


def create_rdk_client(
    network: str = "testnet",
    endpoints: Optional[dict] = None,
    transport: Optional[Transport] = None,
) -> RdkClient:
    """Create an :class:`RdkClient`. Defaults to the public testnet."""
    return RdkClient(network=network, endpoints=endpoints, transport=transport)


__all__ = ["RdkClient", "create_rdk_client"]
