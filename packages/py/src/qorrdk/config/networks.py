"""Named network presets.

The RDK defaults to testnet. Endpoint defaults point at localhost -- override
them to reach a real node.
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
        name: NetworkConfig(name=name, chain_id=CHAIN_IDS[name], endpoints=Endpoints())
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
    "get_network",
    "list_networks",
]
