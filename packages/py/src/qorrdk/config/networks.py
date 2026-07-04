"""Named network presets.

The RDK defaults to testnet. Each preset ships the network's public endpoints so
``create_rdk_client(network=...)`` works out of the box; override ``endpoints``
to point at a local node (:data:`LOCALHOST_ENDPOINTS`) or your own infrastructure.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..constants import CHAIN_IDS, NETWORK_NAMES


@dataclass
class Endpoints:
    """Endpoint URLs the RDK talks to."""

    #: Cosmos REST (LCD) -- rollup/batch/DA/params reads.
    rest: str = "http://localhost:1317"
    #: Consensus RPC -- transaction broadcast.
    rpc: str = "http://localhost:26657"
    #: gRPC (host:port) -- typed queries (parity with REST).
    grpc: str = "localhost:9090"
    #: EVM + ``qor_`` JSON-RPC -- the custom ``qor_*`` rollup methods.
    evm_rpc: str = "http://localhost:8545"

    def copy(self) -> "Endpoints":
        return replace(self)


#: Localhost defaults, for running against a local node.
LOCALHOST_ENDPOINTS: Endpoints = Endpoints()

#: Public mainnet endpoints (``qorechain-vladi``).
MAINNET_ENDPOINTS: Endpoints = Endpoints(
    rest="https://api.qore.host",
    rpc="https://rpc.qore.host",
    grpc="grpc.qore.host:443",
    evm_rpc="https://evm.qore.host",
)

#: Public testnet endpoints (``qorechain-diana``).
TESTNET_ENDPOINTS: Endpoints = Endpoints(
    rest="https://api-testnet.qore.host",
    rpc="https://rpc-testnet.qore.host",
    grpc="grpc-testnet.qore.host:443",
    evm_rpc="https://evm-testnet.qore.host",
)

#: Public endpoints per network name.
_NETWORK_ENDPOINTS: dict[str, Endpoints] = {
    "testnet": TESTNET_ENDPOINTS,
    "mainnet": MAINNET_ENDPOINTS,
}


@dataclass
class NetworkConfig:
    """A resolved network: its chain id and endpoints."""

    name: str
    chain_id: str
    endpoints: Endpoints

    def copy(self) -> "NetworkConfig":
        return replace(self, endpoints=self.endpoints.copy())


def _build_networks() -> dict[str, NetworkConfig]:
    return {
        name: NetworkConfig(
            name=name,
            chain_id=CHAIN_IDS[name],
            endpoints=_NETWORK_ENDPOINTS.get(name, LOCALHOST_ENDPOINTS).copy(),
        )
        for name in NETWORK_NAMES
    }


#: Built-in network presets.
NETWORKS: dict[str, NetworkConfig] = _build_networks()


def get_network(name: str = "testnet") -> NetworkConfig:
    """Look up a network preset by name. Defaults to testnet."""
    if name not in NETWORKS:
        raise ValueError(
            f'unknown network "{name}" (available: {", ".join(NETWORK_NAMES)})'
        )
    return NETWORKS[name].copy()


def list_networks() -> list[str]:
    """List the available network names."""
    return list(NETWORKS.keys())


__all__ = [
    "Endpoints",
    "NetworkConfig",
    "NETWORKS",
    "LOCALHOST_ENDPOINTS",
    "MAINNET_ENDPOINTS",
    "TESTNET_ENDPOINTS",
    "get_network",
    "list_networks",
]
