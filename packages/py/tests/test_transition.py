"""Batch transition roots against vectors from the chain's own BatchTransitionRoot."""

import json

import pytest

from qorrdk import (
    batch_transition_root,
    batch_transition_root_v1,
    batch_transition_root_v2,
    create_rdk_client,
    fraud_proof,
    transition_root_version_for,
)
from qorrdk.client.http import HttpResponse


def test_v1_and_v2_match_the_chain(golden):
    t = golden["transitionRoot"]
    assert batch_transition_root_v1(t["prevStateRoot"], t["txCount"], t["dataHash"]).hex() == t["v1"]
    assert batch_transition_root_v1(t["prevStateRoot"], 1).hex() == t["emptyBatch"]["v1"]
    v2 = batch_transition_root_v2(
        t["chainId"], t["rollupId"], t["prevStateRoot"], t["txCount"], t["dataHash"], t["withdrawalsRoot"]
    )
    assert v2.hex() == t["v2"]
    other = batch_transition_root(
        "v2", t["prevStateRoot"], t["txCount"], t["dataHash"],
        t["v2OtherChain"]["chainId"], t["rollupId"], t["withdrawalsRoot"],
    )
    assert other.hex() == t["v2OtherChain"]["root"]
    assert batch_transition_root_v2(t["chainId"], t["rollupId"], t["prevStateRoot"], 1).hex() == t["emptyBatch"]["v2"]


def test_v2_refuses_bad_input(golden):
    t = golden["transitionRoot"]
    with pytest.raises(ValueError, match="chain id"):
        batch_transition_root_v2("", t["rollupId"], t["prevStateRoot"], 1)
    with pytest.raises(ValueError, match="empty or 32 bytes"):
        batch_transition_root_v2(t["chainId"], t["rollupId"], t["prevStateRoot"], 1, None, "abcd")


def _client(status, body):
    def transport(method, url, headers=None, body_=None):
        return HttpResponse(status, "OK" if status == 200 else "Err", json.dumps(body))
    return create_rdk_client(transport=transport)


def test_version_follows_the_chain_feature():
    on = {"features": [{"name": "rdk-withdrawals-binding", "enabled": True}]}
    off = {"features": [{"name": "rdk-withdrawals-binding", "enabled": False}]}
    assert transition_root_version_for(_client(200, on).rest) == "v2"
    assert transition_root_version_for(_client(200, off).rest) == "v1"
    assert transition_root_version_for(_client(501, {}).rest) == "v1"
    with pytest.raises(RuntimeError, match="500"):
        transition_root_version_for(_client(500, {}).rest)


def test_fraud_proof_layout():
    assert fraud_proof("11" * 32, "22" * 32).hex() == "11" * 32 + "22" * 32
    with pytest.raises(ValueError):
        fraud_proof("11", "22" * 32)
