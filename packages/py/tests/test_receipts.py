"""Settlement receipts: anchor sign-bytes, cross-impl ML-DSA-87, chain verification."""

from __future__ import annotations

import json

from qorrdk import (
    SettlementReceipt,
    anchor_sign_bytes,
    build_settlement_receipt,
    create_rdk_client,
    verify_settlement_receipt,
)
from qorrdk.client.http import HttpResponse
from qorrdk.utils.bytes import bytes_to_base64


def test_anchor_sign_bytes_matches_golden(golden):
    v = golden["anchorSignBytes"]
    out = anchor_sign_bytes(
        v["layerId"], v["layerHeight"], v["stateRoot"], v["validatorSetHash"]
    )
    assert out.hex() == v["expectedHex"]


def test_mldsa_crossimpl_vector(golden):
    """The chain's own PQC library verifies the shared ML-DSA-87 vector."""
    from qorpqc import mldsa

    v = golden["mldsaVector"]
    assert (
        mldsa.verify(
            bytes.fromhex(v["publicKeyHex"]),
            v["messageUtf8"].encode(),
            bytes.fromhex(v["signatureHex"]),
        )
        is True
    )


def _receipt_routes(golden, tamper_signature: bool = False):
    """Wire responses for a rollup whose batch state root is anchored under PQC.

    The anchor's state_root / validator_set_hash / pqc_signature are encoded as
    base64 on the wire (jsonpb), exactly as the chain serves them.
    """
    av = golden["anchorSignBytes"]
    layer_id = av["layerId"]
    state_root_hex = av["stateRoot"]
    vsh_hex = av["validatorSetHash"]
    # The golden mldsaVector signs `messageUtf8`, not the canonical anchor
    # message. To exercise a real PQC verification we sign the canonical anchor
    # message with a freshly generated key and serve the corresponding public
    # key from the pqc account route.
    from qorpqc import mldsa

    pk, sk = mldsa.keygen()
    message = anchor_sign_bytes(layer_id, av["layerHeight"], state_root_hex, vsh_hex)
    signature = bytearray(mldsa.sign(sk, message))
    if tamper_signature:
        signature[10] ^= 0xFF

    creator = "qor1creator"
    anchor = {
        "layer_id": layer_id,
        "layer_height": av["layerHeight"],
        "state_root": bytes_to_base64(bytes.fromhex(state_root_hex)),
        "validator_set_hash": bytes_to_base64(bytes.fromhex(vsh_hex)),
        "main_chain_height": 1000,
        "anchored_at": 1700000000,
        "pqc_aggregate_signature": bytes_to_base64(bytes(signature)),
        "transaction_count": 7,
        "compressed_state_proof": "",
    }
    routes = {
        ("GET", "/qorechain/rdk/v1/rollup/r1"): {
            "rollup": {
                "rollup_id": "r1",
                "creator": creator,
                "profile": "defi",
                "status": "active",
                "layer_id": layer_id,
            }
        },
        ("GET", "/qorechain/rdk/v1/batch/r1/0"): {
            "batch": {
                "rollup_id": "r1",
                "batch_index": 0,
                # batch state_root served as base64 too.
                "state_root": bytes_to_base64(bytes.fromhex(state_root_hex)),
                "status": "finalized",
            }
        },
        ("GET", f"/qorechain/multilayer/v1/anchors/{layer_id}"): {"anchors": [anchor]},
        ("GET", f"/qorechain/pqc/v1/accounts/{creator}"): {
            "account": {
                "address": creator,
                "public_key": bytes_to_base64(pk),
                "algorithm_id": 3,
                "algorithm_name": "ML-DSA-87",
            }
        },
    }
    return routes, bytes(pk)


class _MockTransport:
    def __init__(self, routes):
        self._routes = routes

    def __call__(self, method, url, headers=None, body=None):
        for (m, needle), payload in self._routes.items():
            if m == method and needle in url:
                return HttpResponse(200, "OK", json.dumps(payload))
        return HttpResponse(404, "Not Found", json.dumps({"error": "no route"}))


def _client(golden, tamper_signature: bool = False):
    routes, pubkey = _receipt_routes(golden, tamper_signature=tamper_signature)
    return create_rdk_client(transport=_MockTransport(routes)), pubkey


def test_receipt_round_trip(golden):
    """A genuine receipt reproduces live chain state and verifies in chain mode."""
    client, _ = _client(golden)

    receipt = build_settlement_receipt(client, "r1", 0)
    assert receipt.version == 1
    assert receipt.algorithm == "ML-DSA-87"
    assert receipt.rollup_id == "r1"
    assert receipt.state_root == receipt.batch_state_root
    assert receipt.state_root == golden["anchorSignBytes"]["stateRoot"]

    result = verify_settlement_receipt(receipt, client=client)
    assert result.valid is True
    assert result.mode == "chain"
    assert result.checks.rollup_layer_binding is True
    assert result.checks.batch_state_root is True
    assert result.checks.anchor_on_chain is True
    assert result.checks.creator_authority is True
    assert result.checks.pqc_signature is True


def test_receipt_tamper_signature_fails(golden):
    """A receipt whose signature was altered after the fact never verifies."""
    client, _ = _client(golden)

    receipt = build_settlement_receipt(client, "r1", 0)
    # Flip one byte of the signature.
    sig = bytearray(bytes.fromhex(receipt.pqc_signature))
    sig[0] ^= 0xFF
    receipt.pqc_signature = bytes(sig).hex()

    result = verify_settlement_receipt(receipt, client=client)
    assert result.valid is False
    assert result.mode == "chain"
    # The altered signature no longer matches the anchor the chain holds.
    assert result.checks.anchor_on_chain is False


def test_chain_signature_mismatch_fails(golden):
    """An anchor whose on-chain signature does not verify is not valid."""
    client, _ = _client(golden, tamper_signature=True)

    receipt = build_settlement_receipt(client, "r1", 0)
    result = verify_settlement_receipt(receipt, client=client)
    assert result.valid is False
    assert result.mode == "chain"
    assert result.checks.anchor_on_chain is True
    assert result.checks.creator_authority is True
    assert result.checks.pqc_signature is False


def test_signature_only_is_never_valid(golden):
    """Even a genuine receipt is not proof when only the signature was checked."""
    client, pubkey = _client(golden)
    receipt = build_settlement_receipt(client, "r1", 0)

    result = verify_settlement_receipt(receipt, creator_public_key=pubkey.hex())
    assert result.checks.pqc_signature is True  # the signature really is good
    assert result.valid is False  # but nothing was checked against the chain
    assert result.mode == "signature-only"
    assert "nothing was checked against the chain" in (result.reason or "")


def test_verify_without_key_or_client_returns_invalid(golden):
    client, _ = _client(golden)
    receipt = build_settlement_receipt(client, "r1", 0)

    result = verify_settlement_receipt(receipt)
    assert result.valid is False
    assert result.mode == "signature-only"
    assert result.checks.pqc_signature is False
    assert "pass `client`" in (result.reason or "")


def test_qsr_2026_0055_fabricated_receipt_is_rejected(golden):
    """QSR-2026-0055 regression: a receipt is a claim, not evidence.

    An attacker generates their own ML-DSA-87 keypair, invents a state root,
    makes both state-root fields agree (defeating the old vacuous "binding"
    check) and signs the canonical anchor bytes. The signature is internally
    consistent, so signature-only mode reports the signature as good -- but the
    result must never be ``valid``, and against a chain that knows nothing of
    this rollup or layer it must fail outright.
    """
    from qorpqc import mldsa

    evil_pk, evil_sk = mldsa.keygen()
    fake = SettlementReceipt(
        version=1,
        rollup_id="victim-rollup",
        layer_id="layer-victim",
        batch_index=999,
        creator="qor1attackerownaddressxxxxxxxxxxxxxxxxxxx",
        algorithm="ML-DSA-87",
        state_root="de" * 32,
        layer_height=123456,
        validator_set_hash="ab" * 32,
        main_chain_height=999999,
        anchored_at=1757000000,
        pqc_signature="",
        # The attacker controls both sides of the old "binding" check.
        batch_state_root="de" * 32,
    )
    fake.pqc_signature = mldsa.sign(evil_sk, anchor_sign_bytes(fake)).hex()
    assert fake.state_root == fake.batch_state_root

    # Signature-only: the signature is internally consistent, but proves nothing.
    sig_only = verify_settlement_receipt(fake, creator_public_key=evil_pk.hex())
    assert sig_only.checks.pqc_signature is True
    assert sig_only.valid is False
    assert sig_only.mode == "signature-only"

    # Against the chain: the rollup/layer does not exist, so it cannot pass.
    client, _ = _client(golden)
    result = verify_settlement_receipt(fake, client=client)
    assert result.valid is False
    assert result.mode == "chain"
    assert result.checks.rollup_layer_binding is False
