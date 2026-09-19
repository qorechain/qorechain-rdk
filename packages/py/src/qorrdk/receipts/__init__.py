"""Quantum-Safe Settlement Receipts.

A settlement receipt is a portable record that a rollup's settlement batch was
anchored to the QoreChain Main Chain under a post-quantum (ML-DSA-87 /
Dilithium-5) signature.

A receipt is a **claim, not evidence** -- every field in it is supplied by
whoever hands it to you. :func:`verify_settlement_receipt` therefore re-reads
the claim from live chain state (the rollup's layer, the batch's state root, the
anchor, and the creator's registered key) and only then reports it valid.
Checking the signature alone, against a key you were handed, proves that someone
signed those bytes -- not that QoreChain anchored anything. There is no offline
verification: without a client the result is ``mode="signature-only"`` and never
``valid``.

Canonical anchor message (matches the chain's ``anchorSignBytes``)::

    layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional, Union

from ..client.views import AnchorView, RollupView
from ..utils.bytes import bytes_to_hex, decode_wire_bytes, hex_to_bytes

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..client.rdk_client import RdkClient

#: The post-quantum algorithm the anchor signature uses.
RECEIPT_ALGORITHM = "ML-DSA-87"

#: Current receipt schema version.
RECEIPT_VERSION = 1

#: Every field was reproduced from live chain state. Only this mode can be valid.
MODE_CHAIN = "chain"

#: Only the signature was checked, against a caller-supplied key. Never valid.
MODE_SIGNATURE_ONLY = "signature-only"

#: How a receipt was checked: ``"chain"`` or ``"signature-only"``.
ReceiptVerificationMode = str


@dataclass
class SettlementReceipt:
    """A portable settlement receipt.

    Verify it with :func:`verify_settlement_receipt` -- against a live client.
    """

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
    #: The state root read from the settlement batch (hex) when the receipt was
    #: built. **Informational only** -- verification compares the receipt
    #: against the chain's batch, never against this copy of it.
    batch_state_root: str


@dataclass
class ReceiptChecks:
    """Individual checks performed during receipt verification."""

    #: The chain says ``rollup_id`` belongs to the receipt's ``layer_id``.
    rollup_layer_binding: bool = False
    #: The chain's batch carries the receipt's state root.
    batch_state_root: bool = False
    #: An anchor with this state root, height and signature exists on chain.
    anchor_on_chain: bool = False
    #: The signing key was resolved from chain, not taken from the receipt.
    creator_authority: bool = False
    #: The Dilithium-5 signature over the canonical message verified.
    pqc_signature: bool = False


@dataclass
class ReceiptVerification:
    """The outcome of verifying a receipt."""

    #: True only when the receipt was reproduced from live chain state.
    valid: bool
    #: Which check was actually performed: ``"chain"`` or ``"signature-only"``.
    mode: ReceiptVerificationMode = MODE_CHAIN
    checks: ReceiptChecks = field(default_factory=ReceiptChecks)
    reason: Optional[str] = None


def anchor_sign_bytes(
    layer_id: Union[str, SettlementReceipt],
    layer_height: Optional[int] = None,
    state_root: Optional[str] = None,
    validator_set_hash: Optional[str] = None,
) -> bytes:
    """Reconstruct the canonical message the chain signs for a state anchor.

    ``layer_id || layer_height(8B BE) || state_root || validator_set_hash``.
    ``state_root`` and ``validator_set_hash`` are taken in hex; ``layer_height``
    is a uint64. A :class:`SettlementReceipt` may be passed as the sole argument,
    in which case its fields are used.
    """
    if isinstance(layer_id, SettlementReceipt):
        receipt = layer_id
        layer_id = receipt.layer_id
        layer_height = receipt.layer_height
        state_root = receipt.state_root
        validator_set_hash = receipt.validator_set_hash
    if layer_height is None or state_root is None or validator_set_hash is None:
        raise TypeError(
            "anchor_sign_bytes requires either a SettlementReceipt or "
            "(layer_id, layer_height, state_root, validator_set_hash)"
        )
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


def _signature_over(receipt: SettlementReceipt, public_key_hex: str) -> bool:
    """Verify the receipt's ML-DSA-87 signature over the canonical anchor bytes."""
    if not public_key_hex or receipt.pqc_signature == "":
        return False
    try:
        from qorpqc import mldsa

        return bool(
            mldsa.verify(
                hex_to_bytes(public_key_hex),
                anchor_sign_bytes(receipt),
                hex_to_bytes(receipt.pqc_signature),
            )
        )
    except Exception:  # noqa: BLE001 - any failure means "did not verify"
        return False


def verify_settlement_receipt(
    receipt: SettlementReceipt,
    creator_public_key: Optional[str] = None,
    client: Optional["RdkClient"] = None,
) -> ReceiptVerification:
    """Verify a settlement receipt against live chain state.

    A receipt is a *claim*, not evidence: every field in it is supplied by
    whoever hands it to you. Verification therefore re-reads the claim from the
    chain -- the rollup's layer, the batch's state root, the anchor itself, and
    the signing key -- and reports ``valid=True`` only when the receipt
    reproduces what the chain actually holds. Pass ``client`` for this.

    Without a ``client`` you can still check the signature
    (``creator_public_key``), but that is ``mode="signature-only"`` and never
    valid: a signature proves someone signed these bytes, not that the anchor
    exists on QoreChain.
    """
    checks = ReceiptChecks()

    if client is None:
        if not creator_public_key:
            return ReceiptVerification(
                valid=False,
                mode=MODE_SIGNATURE_ONLY,
                checks=checks,
                reason=(
                    "no client supplied -- pass `client` to verify against chain "
                    "state; a receipt on its own proves nothing"
                ),
            )
        checks.pqc_signature = _signature_over(receipt, creator_public_key)
        return ReceiptVerification(
            valid=False,
            mode=MODE_SIGNATURE_ONLY,
            checks=checks,
            reason=(
                "signature is valid for the supplied key, but nothing was checked "
                "against the chain -- pass `client` to verify settlement"
                if checks.pqc_signature
                else "signature did not verify against the supplied key"
            ),
        )

    rest = client.rest

    def fail(reason: str) -> ReceiptVerification:
        return ReceiptVerification(
            valid=False, mode=MODE_CHAIN, checks=checks, reason=reason
        )

    # 1. The rollup must exist on chain and belong to the layer the receipt names.
    try:
        rollup: RollupView = rest.get_rollup(receipt.rollup_id)
    except Exception as err:  # noqa: BLE001 - surface the lookup failure
        return fail(f'rollup "{receipt.rollup_id}" not found on chain: {err}')
    checks.rollup_layer_binding = bool(rollup.layer_id) and rollup.layer_id == receipt.layer_id
    if not checks.rollup_layer_binding:
        return fail(
            f'rollup "{receipt.rollup_id}" is anchored to layer '
            f'"{rollup.layer_id or "(none)"}", not "{receipt.layer_id}"'
        )

    # 2. The chain's batch must carry the receipt's state root (not the receipt's copy).
    try:
        batch = rest.get_batch(receipt.rollup_id, receipt.batch_index)
    except Exception as err:  # noqa: BLE001
        return fail(f"batch {receipt.batch_index} not found on chain: {err}")
    on_chain_root = (
        bytes_to_hex(decode_wire_bytes(batch.state_root)) if batch.state_root else ""
    )
    checks.batch_state_root = on_chain_root != "" and on_chain_root == receipt.state_root
    if not checks.batch_state_root:
        return fail("the chain's batch does not carry the receipt's state root")

    # 3. An anchor matching this receipt must actually exist on chain.
    try:
        anchors = rest.get_anchors(receipt.layer_id)
    except Exception as err:  # noqa: BLE001
        return fail(f'could not read anchors for layer "{receipt.layer_id}": {err}')
    checks.anchor_on_chain = any(
        a.state_root == receipt.state_root
        and a.layer_height == receipt.layer_height
        and a.validator_set_hash == receipt.validator_set_hash
        and a.pqc_signature == receipt.pqc_signature
        for a in anchors
    )
    if not checks.anchor_on_chain:
        return fail(
            "no anchor on chain matches this receipt -- it is fabricated or superseded"
        )

    # 4. The signing key is resolved from the chain, never taken from the receipt.
    if receipt.creator != rollup.creator:
        return fail(
            f'receipt names creator "{receipt.creator}" but the chain says the '
            f'rollup\'s creator is "{rollup.creator}"'
        )
    try:
        account = rest.get_pqc_account(rollup.creator)
    except Exception as err:  # noqa: BLE001
        return fail(f"could not resolve the creator's post-quantum key: {err}")
    public_key_hex = account.public_key
    checks.creator_authority = bool(public_key_hex)
    if not checks.creator_authority:
        return fail(
            f"no post-quantum key is registered for creator {rollup.creator}"
        )

    # 5. Finally the post-quantum signature over the canonical anchor message.
    checks.pqc_signature = _signature_over(receipt, public_key_hex)
    if not checks.pqc_signature:
        return fail(
            "Dilithium-5 anchor signature did not verify against the creator's "
            "registered key"
        )
    return ReceiptVerification(valid=True, mode=MODE_CHAIN, checks=checks)


__all__ = [
    "RECEIPT_ALGORITHM",
    "RECEIPT_VERSION",
    "MODE_CHAIN",
    "MODE_SIGNATURE_ONLY",
    "ReceiptVerificationMode",
    "SettlementReceipt",
    "ReceiptChecks",
    "ReceiptVerification",
    "anchor_sign_bytes",
    "build_settlement_receipt",
    "verify_settlement_receipt",
]
