"""``RdkClient`` -- the high-level entry point.

Resolves a network, composes the REST and ``qor_`` JSON-RPC read clients, exposes
the QCAI-assisted profile suggestion, and connects a signing tx client.
"""

from __future__ import annotations

from typing import Optional

from ..config.networks import NetworkConfig, get_network
from ..enums import ProfileName
from .http import Transport
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

    def suggest_profile(
        self, use_case: str, fallback: ProfileName = ProfileName.DEFI
    ):
        """QCAI-assisted profile suggestion, with a documented fallback to ``defi``."""
        from ..profiles import suggest_profile

        return suggest_profile(use_case, self.qor, fallback)

    def connect_tx(self, signer) -> "RdkTxClient":
        """Connect a signing tx client bound to this network's REST + chain id."""
        from ..tx.client import RdkTxClient

        return RdkTxClient(
            rest_url=self.network.endpoints.rest,
            chain_id=self.network.chain_id,
            signer=signer,
            transport=self._transport,
        )


def create_rdk_client(
    network: str = "testnet",
    endpoints: Optional[dict] = None,
    transport: Optional[Transport] = None,
) -> RdkClient:
    """Create an :class:`RdkClient`. Defaults to the public testnet."""
    return RdkClient(network=network, endpoints=endpoints, transport=transport)


__all__ = ["RdkClient", "create_rdk_client"]
