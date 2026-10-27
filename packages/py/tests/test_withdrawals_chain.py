"""Withdrawals, DA commitments and the v3.2.5 rules, against the chain's vectors.

Every proof in the ``withdrawalTree`` vectors is accepted by the chain's own
``VerifyWithdrawalMerkle``, and refused at the wrong index.
"""

from __future__ import annotations

import pytest

from qorrdk import (
    MAX_PENDING_OPTIMISTIC_BATCHES,
    MockTxClient,
    RdkTxClient,
    WithdrawalLeafInput,
    binary_merkle_proof,
    binary_merkle_root,
    build_da_blob,
    map_rollup_view,
    qorehash,
    stop_rollup_error,
    verify_binary_merkle_proof,
    withdrawal_leaf_v1,
    withdrawal_leaf_v2,
    withdrawals_root_error,
    withdrawals_tree,
)
from qorrdk.bridge.merkle import MerkleOptions


def _items(golden):
    w = golden["withdrawalTree"]
    return [{**x, "denom": w["denom"]} for x in w["withdrawals"]]


# ---- withdrawals, exactly as the chain builds them ------------------------ #

@pytest.mark.parametrize("version", ["v1", "v2"])
def test_tree_leaves_root_and_every_proof_match_the_chain(golden, version):
    w = golden["withdrawalTree"]
    items = _items(golden)
    tree = withdrawals_tree(items, rollup_id=w["rollupId"], version=version, chain_id=w["chainId"])
    assert [leaf.hex() for leaf in tree.leaves] == w[version]["leaves"]
    assert tree.root.hex() == w[version]["root"]
    chain = MerkleOptions(hash_leaves=False)
    for i in range(len(items)):
        p = tree.proof(i)
        assert p.withdrawal_index == i
        assert [s.hex() for s in p.proof] == w[version]["proofs"][i]
        assert p.withdrawals_root.hex() == w[version]["root"]
        assert verify_binary_merkle_proof(tree.leaves[i], i, p.proof, tree.root, chain)


def test_single_leaves_match_the_chains_functions(golden):
    w = golden["withdrawalTree"]
    inp = WithdrawalLeafInput(
        rollup_id=w["rollupId"],
        withdrawal_index=0,
        recipient="qor1alice",
        denom="uqor",
        amount=1_500_000,
    )
    assert withdrawal_leaf_v1(inp).hex() == w["v1"]["leaves"][0]
    assert withdrawal_leaf_v2(w["chainId"], inp).hex() == w["v2"]["leaves"][0]
    with pytest.raises(ValueError, match="chain id"):
        withdrawal_leaf_v2("", inp)


def test_single_leaf_vector_accepts_a_dict(golden):
    v = golden["withdrawalLeaf"]
    inp = {
        "rollup_id": v["rollupId"],
        "withdrawal_index": v["withdrawalIndex"],
        "recipient": v["recipient"],
        "denom": v["denom"],
        "amount": v["amount"],
    }
    assert withdrawal_leaf_v1(inp).hex() == v["v1"]
    assert withdrawal_leaf_v2(v["v2ChainId"], inp).hex() == v["v2"]


def test_v1_and_v2_trees_differ(golden):
    w = golden["withdrawalTree"]
    assert w["v1"]["root"] != w["v2"]["root"]


def test_tree_errors(golden):
    w = golden["withdrawalTree"]
    with pytest.raises(ValueError, match="at least one"):
        withdrawals_tree([], rollup_id=w["rollupId"], version="v1")
    with pytest.raises(ValueError, match="chain id"):
        withdrawals_tree(_items(golden), rollup_id=w["rollupId"], version="v2")


# ---- generic Merkle defaults are the chain's hash ------------------------- #

def test_merkle_defaults_to_shake256(golden):
    leaves = [bytes.fromhex(h) for h in golden["merkle"]["leavesHex"]]
    assert binary_merkle_root(leaves).hex() == golden["merkle"]["root"]
    siblings = binary_merkle_proof(leaves, 1).siblings
    assert [s.hex() for s in siblings] == golden["merkle"]["proofIndex1Siblings"]


def test_qorehash_is_shake256_of_the_concatenation():
    assert qorehash(b"ab", b"c") == qorehash(b"abc")
    assert len(qorehash()) == 32


# ---- DA blob commitment --------------------------------------------------- #

def test_da_blob_commitment_is_the_chains(golden):
    blob = build_da_blob(golden["daBlob"]["dataUtf8"].encode("utf-8"))
    assert blob.data_hash == "0x" + golden["daBlob"]["commitment"]


# ---- v3.2.5 rules --------------------------------------------------------- #

def test_withdrawals_root_is_empty_or_32_bytes():
    assert withdrawals_root_error(None) is None
    assert withdrawals_root_error("") is None
    assert withdrawals_root_error("0x") is None
    assert withdrawals_root_error(b"") is None
    assert withdrawals_root_error(bytes(32)) is None
    assert withdrawals_root_error("ab" * 32) is None
    err = withdrawals_root_error("ab" * 31)
    assert err == "withdrawals_root must be empty or 32 bytes, got 31"
    assert "33" in withdrawals_root_error(bytes(33))
    assert "hex" in withdrawals_root_error("zz")


def test_a_rollup_with_an_unsettled_latest_batch_cannot_be_stopped():
    assert "submitted" in stop_rollup_error("submitted")
    assert "challenged" in stop_rollup_error("challenged")
    assert stop_rollup_error("finalized") is None
    assert stop_rollup_error("rejected") is None
    assert stop_rollup_error(None) is None
    assert MAX_PENDING_OPTIMISTIC_BATCHES == 4096


def _batch(root):
    return {
        "rollup_id": "roll-r",
        "batch_index": 7,
        "state_root": "11" * 32,
        "tx_count": 1,
        "data_hash": "",
        "withdrawals_root": root,
    }


def test_submit_batch_refuses_a_bad_withdrawals_root_before_broadcast():
    mock = MockTxClient(address="qor1seq")
    tx = RdkTxClient.from_backend(mock)
    with pytest.raises(ValueError, match="cannot submit batch 7: withdrawals_root must be"):
        tx.submit_batch(_batch("ab" * 31))
    assert mock.calls == []


def test_submit_batch_accepts_an_empty_or_32_byte_root():
    mock = MockTxClient(address="qor1seq")
    tx = RdkTxClient.from_backend(mock)
    assert tx.submit_batch(_batch("ab" * 32)).code == 0
    assert tx.submit_batch(_batch(None)).code == 0
    assert len(mock.calls) == 2


# ---- RollupView.has_verification_key -------------------------------------- #

def test_has_verification_key_is_true_only_when_served_true():
    assert map_rollup_view({"has_verification_key": True}).has_verification_key is True
    assert map_rollup_view({"hasVerificationKey": True}).has_verification_key is True
    assert map_rollup_view({"has_verification_key": False}).has_verification_key is None
    assert map_rollup_view({"has_verification_key": "true"}).has_verification_key is None
    assert map_rollup_view({}).has_verification_key is None
