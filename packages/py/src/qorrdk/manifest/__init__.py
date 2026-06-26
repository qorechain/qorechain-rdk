"""Rollup manifest -- a portable JSON snapshot of a rollup's resolved
configuration, target network, endpoints, and key addresses.

The ``rollup.json`` equivalent for this kit: save it, share it, and load it back
into a config builder.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from ..config.builder import RollupConfigBuilder
from ..config.types import RollupConfig, SequencerParams
from ..enums import (
    DABackend,
    GasModel,
    ProfileName,
    ProofSystem,
    SequencerMode,
    SettlementParadigm,
)

MANIFEST_SCHEMA = "qorechain-rdk/rollup-manifest"

# Field name <-> RollupConfig attribute, in camelCase for cross-kit portability.
_CONFIG_FIELDS = [
    ("rollupId", "rollup_id"),
    ("profile", "profile"),
    ("settlement", "settlement"),
    ("sequencer", "sequencer"),
    ("da", "da"),
    ("proofSystem", "proof_system"),
    ("gasModel", "gas_model"),
    ("vmType", "vm_type"),
    ("blockTimeMs", "block_time_ms"),
    ("maxTxPerBlock", "max_tx_per_block"),
    ("challengeWindowSecs", "challenge_window_secs"),
    ("challengeBondUqor", "challenge_bond_uqor"),
    ("maxDaBlobSize", "max_da_blob_size"),
    ("stakeAmountUqor", "stake_amount_uqor"),
]

_SEQ_PARAM_FIELDS = [
    ("sequencerAddress", "sequencer_address"),
    ("sharedSetMinSize", "shared_set_min_size"),
    ("inclusionDelay", "inclusion_delay"),
    ("priorityFeeShare", "priority_fee_share"),
]

_ENUM_OF = {
    "profile": ProfileName,
    "settlement": SettlementParadigm,
    "sequencer": SequencerMode,
    "da": DABackend,
    "proof_system": ProofSystem,
    "gas_model": GasModel,
}


@dataclass
class RollupManifest:
    """A portable rollup configuration snapshot."""

    network: str
    config: RollupConfig
    schema: str = MANIFEST_SCHEMA
    version: int = 1
    chain_id: Optional[str] = None
    endpoints: Optional[dict[str, str]] = None
    addresses: Optional[dict[str, str]] = None
    created_at: Optional[str] = None
    notes: Optional[list[str]] = None


def _config_to_dict(config: RollupConfig) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for wire, attr in _CONFIG_FIELDS:
        value = getattr(config, attr)
        if value is None:
            continue
        out[wire] = getattr(value, "value", value)
    if config.sequencer_params is not None:
        sp: dict[str, Any] = {}
        for wire, attr in _SEQ_PARAM_FIELDS:
            value = getattr(config.sequencer_params, attr)
            if value is not None:
                sp[wire] = value
        if sp:
            out["sequencerParams"] = sp
    return out


def _config_from_dict(data: dict[str, Any]) -> RollupConfig:
    kwargs: dict[str, Any] = {}
    for wire, attr in _CONFIG_FIELDS:
        if wire in data and data[wire] is not None:
            value = data[wire]
            if attr in _ENUM_OF:
                value = _ENUM_OF[attr](value)
            kwargs[attr] = value
    seq = data.get("sequencerParams")
    if isinstance(seq, dict):
        sp_kwargs = {}
        for wire, attr in _SEQ_PARAM_FIELDS:
            if wire in seq and seq[wire] is not None:
                sp_kwargs[attr] = seq[wire]
        kwargs["sequencer_params"] = SequencerParams(**sp_kwargs)
    return RollupConfig(**kwargs)


def to_manifest(
    config: RollupConfig,
    *,
    network: str,
    chain_id: Optional[str] = None,
    endpoints: Optional[dict[str, str]] = None,
    addresses: Optional[dict[str, str]] = None,
    created_at: Optional[str] = None,
    notes: Optional[list[str]] = None,
) -> RollupManifest:
    """Build a manifest from a resolved config."""
    return RollupManifest(
        network=network,
        config=config,
        chain_id=chain_id,
        endpoints=endpoints,
        addresses=addresses,
        created_at=created_at,
        notes=notes,
    )


def from_manifest(manifest: RollupManifest) -> RollupConfigBuilder:
    """Load a manifest into a :class:`RollupConfigBuilder`."""
    if manifest is None or manifest.schema != MANIFEST_SCHEMA:
        raise ValueError("not a qorechain-rdk rollup manifest")
    return RollupConfigBuilder(manifest.config)


def manifest_to_dict(manifest: RollupManifest) -> dict[str, Any]:
    """Convert a manifest to a plain JSON-serializable dict."""
    out: dict[str, Any] = {
        "schema": manifest.schema,
        "version": manifest.version,
        "network": manifest.network,
    }
    if manifest.chain_id is not None:
        out["chainId"] = manifest.chain_id
    if manifest.endpoints is not None:
        out["endpoints"] = manifest.endpoints
    out["config"] = _config_to_dict(manifest.config)
    if manifest.addresses is not None:
        out["addresses"] = manifest.addresses
    if manifest.created_at is not None:
        out["createdAt"] = manifest.created_at
    if manifest.notes is not None:
        out["notes"] = manifest.notes
    return out


def manifest_from_dict(data: dict[str, Any]) -> RollupManifest:
    """Build a manifest from a plain dict."""
    if not isinstance(data, dict) or data.get("schema") != MANIFEST_SCHEMA:
        raise ValueError("not a qorechain-rdk rollup manifest")
    return RollupManifest(
        network=data["network"],
        config=_config_from_dict(data["config"]),
        schema=data["schema"],
        version=data.get("version", 1),
        chain_id=data.get("chainId"),
        endpoints=data.get("endpoints"),
        addresses=data.get("addresses"),
        created_at=data.get("createdAt"),
        notes=data.get("notes"),
    )


def stringify_manifest(manifest: RollupManifest) -> str:
    """Serialize a manifest to pretty JSON (trailing newline)."""
    return json.dumps(manifest_to_dict(manifest), indent=2) + "\n"


def parse_manifest(text: str) -> RollupManifest:
    """Parse a manifest from JSON text."""
    return manifest_from_dict(json.loads(text))


__all__ = [
    "MANIFEST_SCHEMA",
    "RollupManifest",
    "to_manifest",
    "from_manifest",
    "manifest_to_dict",
    "manifest_from_dict",
    "stringify_manifest",
    "parse_manifest",
]
