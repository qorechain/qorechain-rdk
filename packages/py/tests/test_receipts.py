"""Settlement receipts: anchor sign-bytes, cross-impl ML-DSA-87, round-trip."""

from __future__ import annotations

import json

import pytest

from qorrdk import (
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


def _receipt_routes(golden):
    """Wire responses for a rollup whose batch state root is anchored under PQC.

    The anchor's state_root / validator_set_hash / pqc_signature are encoded as
    base64 on the wire (jsonpb), exactly as the chain serves them.
    """
    av = golden["anchorSignBytes"]
    mv = golden["mldsaVector"]
    layer_id = av["layerId"]
    state_root_hex = av["stateRoot"]
    vsh_hex = av["validatorSetHash"]
    # The anchor message in the golden vector IS the message the signature covers,
    # but the golden mldsaVector signs `messageUtf8`. To exercise a real PQC
    # verification we sign the canonical anchor message with a freshly generated
    # key and serve the corresponding public key from the pqc account route.
    from qorpqc import mldsa

    pk, sk = mldsa.keygen()
    message = anchor_sign_bytes(
        layer_id, av["layerHeight"], state_root_hex, vsh_hex
    )
    signature = mldsa.sign(sk, message)

    creator = "qor1creator"
    anchor = {
        "layer_id": layer_id,
        "layer_height": av["layerHeight"],
        "state_root": bytes_to_base64(bytes.fromhex(state_root_hex)),
        "validator_set_hash": bytes_to_base64(bytes.fromhex(vsh_hex)),
        "main_chain_height": 1000,
        "anchored_at": 1700000000,
        "pqc_aggregate_signature": bytes_to_base64(signature),
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
    return routes


class _MockTransport:
    def __init__(self, routes):
        self._routes = routes

    def __call__(self, method, url, headers=None, body=None):
        for (m, needle), payload in self._routes.items():
            if m == method and needle in url:
                return HttpResponse(200, "OK", json.dumps(payload))
        return HttpResponse(404, "Not Found", json.dumps({"error": "no route"}))


def test_receipt_round_trip(golden):
    routes = _receipt_routes(golden)
    client = create_rdk_client(transport=_MockTransport(routes))

    receipt = build_settlement_receipt(client, "r1", 0)
    assert receipt.version == 1
    assert receipt.algorithm == "ML-DSA-87"
    assert receipt.rollup_id == "r1"
    assert receipt.state_root == receipt.batch_state_root
    assert receipt.state_root == golden["anchorSignBytes"]["stateRoot"]

    result = verify_settlement_receipt(receipt, client=client)
    assert result.valid is True
    assert result.checks.state_root_binding is True
    assert result.checks.pqc_signature is True
    assert result.checks.has_material is True


def test_receipt_tamper_signature_fails(golden):
    routes = _receipt_routes(golden)
    client = create_rdk_client(transport=_MockTransport(routes))

    receipt = build_settlement_receipt(client, "r1", 0)
    # Flip one byte of the signature.
    sig = bytearray(bytes.fromhex(receipt.pqc_signature))
    sig[0] ^= 0xFF
    receipt.pqc_signature = bytes(sig).hex()

    result = verify_settlement_receipt(receipt, client=client)
    assert result.valid is False
    assert result.checks.pqc_signature is False


def test_verify_offline_with_supplied_pubkey(golden):
    routes = _receipt_routes(golden)
    client = create_rdk_client(transport=_MockTransport(routes))
    receipt = build_settlement_receipt(client, "r1", 0)

    # Resolve the creator's pubkey via the client, then verify fully offline.
    pubkey_hex = client.rest.get_pqc_account(receipt.creator).public_key
    result = verify_settlement_receipt(receipt, creator_public_key=pubkey_hex)
    assert result.valid is True


def test_verify_without_key_or_client_returns_invalid(golden):
    routes = _receipt_routes(golden)
    client = create_rdk_client(transport=_MockTransport(routes))
    receipt = build_settlement_receipt(client, "r1", 0)

    result = verify_settlement_receipt(receipt)
    assert result.valid is False
    assert result.checks.pqc_signature is False
    assert "no creator_public_key" in (result.reason or "")
