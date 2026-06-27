"""Quantum-Safe Settlement Receipts.

A settlement receipt is a portable, self-contained proof that a rollup's
settlement batch was anchored to the QoreChain Main Chain under a post-quantum
(ML-DSA-87 / Dilithium-5) signature. It can be verified fully offline:
reconstruct the canonical anchor message, fetch (or supply) the layer creator's
registered PQC key, and check the Dilithium-5 signature plus the batch<->anchor
state-root binding.

Canonical anchor message (matches the chain's ``anchorSignBytes``)::

    layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from ..client.views import AnchorView
from ..utils.bytes import bytes_to_hex, decode_wire_bytes, hex_to_bytes

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..client.rdk_client import RdkClient

#: The post-quantum algorithm the anchor signature uses.
RECEIPT_ALGORITHM = "ML-DSA-87"

#: Current receipt schema version.
RECEIPT_VERSION = 1


@dataclass
class SettlementReceipt:
    """A portable, offline-verifiable settlement receipt."""

    version: int
    rollup_id: str
    layer_id: str
    batch_index: int
    #: The layer creator -- the registered signer of the anchor's PQC signature.
    creator: str
    algorithm: str
    #: The anchored state root (hex).
    state_root: str
    layer_height: int
    validator_set_hash: str
    main_chain_height: int
    anchored_at: int
    #: The Dilithium-5 anchor signature (hex).
    pqc_signature: str
    #: The state root read from the settlement batch (hex), for the binding check.
    batch_state_root: str


@dataclass
class ReceiptChecks:
    """Individual checks performed during receipt verification."""

    #: The batch's state root equals the anchored state root.
    state_root_binding: bool = False
    #: The Dilithium-5 signature over the canonical message verified.
    pqc_signature: bool = False
    #: A non-empty signature and key were present to check.
    has_material: bool = False


@dataclass
class ReceiptVerification:
    """The outcome of verifying a receipt."""

    valid: bool
    checks: ReceiptChecks = field(default_factory=ReceiptChecks)
    reason: Optional[str] = None


def anchor_sign_bytes(
    layer_id: str,
    layer_height: int,
    state_root: str,
    validator_set_hash: str,
) -> bytes:
    """Reconstruct the canonical message the chain signs for a state anchor.

    ``layer_id || layer_height(8B BE) || state_root || validator_set_hash``.
    ``state_root`` and ``validator_set_hash`` are taken in hex; ``layer_height``
    is a uint64.
    """
    return (
        layer_id.encode("utf-8")
        + struct.pack(">Q", int(layer_height))
        + hex_to_bytes(state_root)
        + hex_to_bytes(validator_set_hash)
    )


def _receipt_from_parts(
    rollup_id: str,
    layer_id: str,
    batch_index: int,
    creator: str,
    anchor: AnchorView,
    batch_state_root_hex: str,
) -> SettlementReceipt:
    return SettlementReceipt(
        version=RECEIPT_VERSION,
        rollup_id=rollup_id,
        layer_id=layer_id,
        batch_index=batch_index,
        creator=creator,
        algorithm=RECEIPT_ALGORITHM,
        state_root=anchor.state_root,
        layer_height=anchor.layer_height,
        validator_set_hash=anchor.validator_set_hash,
        main_chain_height=anchor.main_chain_height,
        anchored_at=anchor.anchored_at,
        pqc_signature=anchor.pqc_signature,
        batch_state_root=batch_state_root_hex,
    )


def build_settlement_receipt(
    client: "RdkClient",
    rollup_id: str,
    batch_index: int,
) -> SettlementReceipt:
    """Build a settlement receipt for ``rollup_id``'s batch ``batch_index``.

    Resolve the rollup's layer, read the batch's state root, and find the state
    anchor that commits that root to the Main Chain. Raises if the rollup has no
    layer, the batch is missing, or no anchor covers the batch's state root yet.
    """
    rollup = client.rest.get_rollup(rollup_id)
    if not rollup.layer_id:
        raise ValueError(
            f'rollup "{rollup_id}" has no layer_id '
            "-- it is not anchored to a multilayer layer"
        )
    batch = client.rest.get_batch(rollup_id, batch_index)
    batch_state_root_hex = (
        bytes_to_hex(decode_wire_bytes(batch.state_root)) if batch.state_root else ""
    )

    anchors = client.rest.get_anchors(rollup.layer_id)
    covering = next(
        (a for a in anchors if a.state_root and a.state_root == batch_state_root_hex),
        None,
    )
    anchor = covering or client.rest.get_latest_anchor(rollup.layer_id)
    if not anchor.state_root:
        raise ValueError(f'no state anchor found for layer "{rollup.layer_id}"')
    if covering is None:
        raise ValueError(
            f"no anchor commits batch {batch_index}'s state root yet "
            f"(latest anchored height {anchor.layer_height}); "
            "the batch may not be anchored to the Main Chain"
        )
    return _receipt_from_parts(
        rollup_id, rollup.layer_id, batch_index, rollup.creator, anchor, batch_state_root_hex
    )


def verify_settlement_receipt(
    receipt: SettlementReceipt,
    creator_public_key: Optional[str] = None,
    client: Optional["RdkClient"] = None,
) -> ReceiptVerification:
    """Verify a settlement receipt.

    Checks the batch<->anchor state-root binding and the Dilithium-5 signature
    over the canonical anchor message. With ``creator_public_key`` supplied this
    is fully offline; otherwise ``client`` fetches the creator's registered
    post-quantum key.
    """
    checks = ReceiptChecks()

    checks.state_root_binding = (
        receipt.state_root != "" and receipt.state_root == receipt.batch_state_root
    )

    public_key_hex = creator_public_key
    if not public_key_hex:
        if client is None:
            return ReceiptVerification(
                valid=False,
                checks=checks,
                reason="no creator_public_key supplied and no client to fetch the creator's PQC key",
            )
        account = client.rest.get_pqc_account(receipt.creator)
        public_key_hex = account.public_key

    checks.has_material = bool(public_key_hex) and receipt.pqc_signature != ""
    if not checks.has_material:
        return ReceiptVerification(
            valid=False, checks=checks, reason="missing public key or anchor signature"
        )

    message = anchor_sign_bytes(
        receipt.layer_id,
        receipt.layer_height,
        receipt.state_root,
        receipt.validator_set_hash,
    )
    try:
        from qorpqc import mldsa

        checks.pqc_signature = bool(
            mldsa.verify(
                hex_to_bytes(public_key_hex),
                message,
                hex_to_bytes(receipt.pqc_signature),
            )
        )
    except Exception as err:  # noqa: BLE001 - report any verification failure
        return ReceiptVerification(
            valid=False, checks=checks, reason=f"signature check failed: {err}"
        )

    valid = checks.state_root_binding and checks.pqc_signature
    reason: Optional[str] = None
    if not valid:
        reason = (
            "batch state root does not match the anchored state root"
            if not checks.state_root_binding
            else "Dilithium-5 anchor signature did not verify"
        )
    return ReceiptVerification(valid=valid, checks=checks, reason=reason)


__all__ = [
    "RECEIPT_ALGORITHM",
    "RECEIPT_VERSION",
    "SettlementReceipt",
    "ReceiptChecks",
    "ReceiptVerification",
    "anchor_sign_bytes",
    "build_settlement_receipt",
    "verify_settlement_receipt",
]
