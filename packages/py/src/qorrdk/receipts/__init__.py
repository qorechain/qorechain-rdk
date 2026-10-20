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
RECEIPT_VERSION = 2
"""Current receipt schema version.

v2 adds ``chain_id``. The v2 anchor message binds the signature to one network,
and a receipt shown to a third party should say which network it is for rather
than leave them to assume. Version-1 receipts still verify.
"""

ANCHOR_SIGN_DOMAIN_V2 = "qorechain-multilayer-anchor-v2"
"""Domain tag of the v2 anchor sign bytes (chain v3.2.2 and above)."""

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
    #: The chain the receipt was built on (e.g. ``"qorechain-vladi"``). Bound
    #: into the v2 anchor signature, and cross-checked against the node being
    #: queried. ``None`` on version-1 receipts.
    chain_id: Optional[str] = None
    #: The anchor's transaction count, covered by the v2 signature. Carried so
    #: a receipt stays self-describing; verification uses the chain's copy.
    transaction_count: Optional[int] = None
    #: The anchor's compressed state proof (hex), covered by the v2 signature.
    #: Empty for a settlement batch. Verification uses the chain's copy.
    compressed_state_proof: Optional[str] = None


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
    #: The receipt names the chain that was actually queried. A version-1
    #: receipt carries no chain id and passes on the strength of the anchor
    #: having been found on this chain.
    chain_binding: bool = False


@dataclass
class ReceiptVerification:
    """The outcome of verifying a receipt."""

    #: True only when the receipt was reproduced from live chain state.
    valid: bool
    #: Which check was actually performed: ``"chain"`` or ``"signature-only"``.
    mode: ReceiptVerificationMode = MODE_CHAIN
    checks: ReceiptChecks = field(default_factory=ReceiptChecks)
    #: Which canonical anchor message the signature was checked against:
    #: ``"v2"`` from the chain's ``rdk-integrity`` height, ``"v1"`` below it.
    sign_bytes_version: Optional[str] = None
    reason: Optional[str] = None


def anchor_sign_bytes_v1(
    layer_id: Union[str, SettlementReceipt],
    layer_height: Optional[int] = None,
    state_root: Optional[str] = None,
    validator_set_hash: Optional[str] = None,
) -> bytes:
    """The **pre-v3.2.2** canonical anchor message.

    ``layer_id || layer_height(8B BE) || state_root || validator_set_hash``.

    Kept because anchors written before the chain's ``rdk-integrity`` switch are
    signed this way and stay valid forever. Do not use it for new work: it
    carries no length prefixes, so field boundaries are ambiguous, and no chain
    id, so a signature is valid on **every** chain. Both are why v2 exists.
    """
    if isinstance(layer_id, SettlementReceipt):
        receipt = layer_id
        layer_id = receipt.layer_id
        layer_height = receipt.layer_height
        state_root = receipt.state_root
        validator_set_hash = receipt.validator_set_hash
    if layer_height is None or state_root is None or validator_set_hash is None:
        raise TypeError(
            "anchor_sign_bytes_v1 requires either a SettlementReceipt or "
            "(layer_id, layer_height, state_root, validator_set_hash)"
        )
    return (
        layer_id.encode("utf-8")
        + struct.pack(">Q", int(layer_height))
        + hex_to_bytes(state_root)
        + hex_to_bytes(validator_set_hash)
    )


def anchor_sign_bytes_v2(
    chain_id: str,
    layer_id: str,
    layer_height: int,
    state_root: str,
    validator_set_hash: str,
    transaction_count: int,
    compressed_state_proof: str = "",
) -> bytes:
    """The **v3.2.2 and later** canonical anchor message.

    Every variable-length field carries an 8-byte big-endian length, the chain
    id binds the signature to one network, and the transaction count and
    compressed state proof are covered too, because the chain computes its
    anchor fraud check from them::

        "qorechain-multilayer-anchor-v2"
         | BE64 len(chain_id)               chain_id
         | BE64 len(layer_id)               layer_id
         | BE64                             layer_height
         | BE64 len(state_root)             state_root
         | BE64 len(validator_set_hash)     validator_set_hash
         | BE64                             transaction_count
         | BE64 len(compressed_state_proof) compressed_state_proof

    For a settlement batch the chain maps these as: ``layer_id`` is the
    rollup's layer id, ``layer_height`` is the **batch index**, ``state_root``
    is the batch state root, ``transaction_count`` is the batch's transaction
    count, and ``compressed_state_proof`` is empty.
    """
    out = bytearray(ANCHOR_SIGN_DOMAIN_V2.encode("utf-8"))

    def put(b: bytes) -> None:
        out.extend(struct.pack(">Q", len(b)))
        out.extend(b)

    put(chain_id.encode("utf-8"))
    put(layer_id.encode("utf-8"))
    out.extend(struct.pack(">Q", int(layer_height)))
    put(hex_to_bytes(state_root))
    put(hex_to_bytes(validator_set_hash))
    out.extend(struct.pack(">Q", int(transaction_count)))
    put(hex_to_bytes(compressed_state_proof or ""))
    return bytes(out)


def anchor_sign_bytes_version_for(anchor_main_chain_height: int, v2_height: int) -> str:
    """Which anchor message a given anchor was signed over.

    Deciding by height rather than trying both forms matters: a v1 signature
    covers no chain id, so it is valid on *every* chain, and accepting v1 where
    v2 is in force would re-admit exactly the weakness v2 closes.
    """
    return "v2" if int(anchor_main_chain_height) >= int(v2_height) else "v1"


def anchor_sign_bytes(
    layer_id: Union[str, SettlementReceipt],
    layer_height: Optional[int] = None,
    state_root: Optional[str] = None,
    validator_set_hash: Optional[str] = None,
) -> bytes:
    """The v1 canonical anchor message (kept for backwards compatibility).

    New code should call :func:`anchor_sign_bytes_v1` or
    :func:`anchor_sign_bytes_v2` explicitly.
    """
    return anchor_sign_bytes_v1(layer_id, layer_height, state_root, validator_set_hash)


def _receipt_from_parts(
    rollup_id: str,
    layer_id: str,
    batch_index: int,
    creator: str,
    anchor: AnchorView,
    batch_state_root_hex: str,
    chain_id: str,
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
        chain_id=chain_id,
        transaction_count=anchor.transaction_count,
        compressed_state_proof=anchor.compressed_state_proof,
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
        rollup_id,
        rollup.layer_id,
        batch_index,
        rollup.creator,
        anchor,
        batch_state_root_hex,
        client.network.chain_id,
    )


def _signature_over(
    anchor: AnchorView,
    public_key_hex: str,
    chain_id: str,
    version: str,
) -> bool:
    """Verify the anchor's post-quantum signature.

    Every signed field is taken from the **chain's** anchor, never from the
    receipt -- the receipt only says which anchor to go and look for.
    ``chain_id`` likewise comes from the network being queried.
    """
    if not public_key_hex or anchor.pqc_signature == "":
        return False
    try:
        from qorpqc import mldsa

        if version == "v2":
            message = anchor_sign_bytes_v2(
                chain_id,
                anchor.layer_id,
                anchor.layer_height,
                anchor.state_root,
                anchor.validator_set_hash,
                anchor.transaction_count,
                anchor.compressed_state_proof,
            )
        else:
            message = anchor_sign_bytes_v1(
                anchor.layer_id,
                anchor.layer_height,
                anchor.state_root,
                anchor.validator_set_hash,
            )
        return bool(
            mldsa.verify(
                hex_to_bytes(public_key_hex),
                message,
                hex_to_bytes(anchor.pqc_signature),
            )
        )
    except Exception:  # noqa: BLE001 - any failure means "did not verify"
        return False


def _receipt_as_anchor(receipt: SettlementReceipt) -> AnchorView:
    """The receipt's own copies of the signed fields, for signature-only mode."""
    return AnchorView(
        layer_id=receipt.layer_id,
        layer_height=receipt.layer_height,
        state_root=receipt.state_root,
        validator_set_hash=receipt.validator_set_hash,
        main_chain_height=receipt.main_chain_height,
        anchored_at=receipt.anchored_at,
        pqc_signature=receipt.pqc_signature,
        transaction_count=receipt.transaction_count or 0,
        compressed_state_proof=receipt.compressed_state_proof or "",
    )


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
        # Without a client there is no chain to read, so the receipt's own
        # copies are all there is -- which is why this mode is never valid.
        # Both forms are tried because nothing here reveals the anchor's height.
        as_anchor = _receipt_as_anchor(receipt)
        version = None
        if receipt.chain_id and _signature_over(
            as_anchor, creator_public_key, receipt.chain_id, "v2"
        ):
            checks.pqc_signature = True
            version = "v2"
        elif _signature_over(as_anchor, creator_public_key, "", "v1"):
            checks.pqc_signature = True
            version = "v1"
        return ReceiptVerification(
            valid=False,
            mode=MODE_SIGNATURE_ONLY,
            checks=checks,
            sign_bytes_version=version,
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
    matched = next(
        (
            a
            for a in anchors
            if a.state_root == receipt.state_root
            and a.layer_height == receipt.layer_height
            and a.validator_set_hash == receipt.validator_set_hash
            and a.pqc_signature == receipt.pqc_signature
        ),
        None,
    )
    checks.anchor_on_chain = matched is not None
    if matched is None:
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

    # 5. The receipt must name the chain we actually queried. A version-1
    # receipt carries no chain id; it still verifies, because step 3 already
    # required the anchor to exist on *this* chain, but the binding is the chain
    # read rather than the receipt's own word.
    chain_id = client.network.chain_id
    if receipt.chain_id and receipt.chain_id != chain_id:
        return fail(
            f'receipt is for chain "{receipt.chain_id}" but this client is '
            f'connected to "{chain_id}" -- verify it against a node for its '
            "own network"
        )
    checks.chain_binding = True

    # 6. Finally the post-quantum signature, over the form the chain had in
    # force at the height this anchor was recorded at.
    version = anchor_sign_bytes_version_for(
        matched.main_chain_height, client.network.anchor_sign_v2_height
    )
    checks.pqc_signature = _signature_over(matched, public_key_hex, chain_id, version)
    if not checks.pqc_signature:
        return ReceiptVerification(
            valid=False,
            mode=MODE_CHAIN,
            checks=checks,
            sign_bytes_version=version,
            reason=(
                "Dilithium-5 anchor signature did not verify against the "
                f"creator's registered key (checked as {version}, for an anchor "
                f"at height {matched.main_chain_height})"
            ),
        )
    return ReceiptVerification(
        valid=True, mode=MODE_CHAIN, checks=checks, sign_bytes_version=version
    )


__all__ = [
    "RECEIPT_ALGORITHM",
    "RECEIPT_VERSION",
    "ANCHOR_SIGN_DOMAIN_V2",
    "anchor_sign_bytes_v1",
    "anchor_sign_bytes_v2",
    "anchor_sign_bytes_version_for",
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
