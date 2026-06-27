"""REST and JSON-RPC clients with a mocked transport."""

from __future__ import annotations

import base64
import json

import pytest

from qorrdk import RestClient, create_rdk_client
from qorrdk.client.http import HttpResponse
from qorrdk.client.jsonrpc import QorClient


class MockTransport:
    """Records requests and replays canned responses keyed by (method, path-substring)."""

    def __init__(self, routes):
        self._routes = routes
        self.calls = []

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append({"method": method, "url": url, "body": body})
        for (m, needle), payload in self._routes.items():
            if m == method and needle in url:
                return HttpResponse(200, "OK", json.dumps(payload))
        return HttpResponse(404, "Not Found", json.dumps({"error": "no route"}))


def test_rest_get_params():
    transport = MockTransport(
        {
            ("GET", "/qorechain/rdk/v1/params"): {
                "params": {
                    "max_rollups": 100,
                    "min_stake_for_rollup": "10000000000",
                    "rollup_creation_burn_rate": "0.01",
                    "default_challenge_window": 604800,
                    "max_da_blob_size": 2097152,
                    "blob_retention_blocks": 432000,
                    "max_batches_per_block": 10,
                }
            }
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    params = rest.get_params()
    assert params.max_rollups == 100
    assert params.min_stake_for_rollup == "10000000000"
    assert params.rollup_creation_burn_rate == "0.01"
    assert params.default_challenge_window == 604800


def test_rest_get_rollup():
    transport = MockTransport(
        {
            ("GET", "/qorechain/rdk/v1/rollup/r1"): {
                "rollup": {
                    "rollup_id": "r1",
                    "creator": "qor1creator",
                    "profile": "defi",
                    "settlement_mode": "zk",
                    "da_backend": "native",
                    "block_time_ms": 500,
                    "max_tx_per_block": 10000,
                    "vm_type": "evm",
                    "status": "active",
                    "stake_amount": "10000000000",
                    "layer_id": "L2-1",
                    "created_height": 42,
                }
            }
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    rollup = rest.get_rollup("r1")
    assert rollup.rollup_id == "r1"
    assert rollup.status == "active"
    assert rollup.stake_amount == "10000000000"
    assert rollup.created_height == 42


def test_rest_list_rollups_and_batch():
    transport = MockTransport(
        {
            ("GET", "/qorechain/rdk/v1/rollups"): {"rollups": [{"rollup_id": "a"}, {"rollup_id": "b"}]},
            ("GET", "/qorechain/rdk/v1/batch/r1/3"): {
                "batch": {"rollup_id": "r1", "batch_index": 3, "status": "finalized", "tx_count": 9}
            },
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    rollups = rest.list_rollups()
    assert [r.rollup_id for r in rollups] == ["a", "b"]
    batch = rest.get_batch("r1", 3)
    assert batch.batch_index == 3
    assert batch.status == "finalized"


def test_rest_balance_and_latest_batch():
    transport = MockTransport(
        {
            ("GET", "/by_denom"): {"balance": {"denom": "uqor", "amount": "12345"}},
            ("GET", "/batches/r1?latest=true"): {"batch": {"rollup_id": "r1", "batch_index": 5, "submitted_at": 100}},
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    assert rest.get_balance("qor1abc") == "12345"
    latest = rest.get_latest_batch("r1")
    assert latest.batch_index == 5


def test_rest_raises_on_error():
    transport = MockTransport({})  # everything 404s
    rest = RestClient("http://localhost:1317", transport=transport)
    with pytest.raises(RuntimeError):
        rest.get_params()


def test_jsonrpc_call_and_error():
    class JsonRpcTransport:
        def __init__(self):
            self.last_body = None

        def __call__(self, method, url, headers=None, body=None):
            self.last_body = json.loads(body)
            if self.last_body["method"] == "qor_getRollupStatus":
                return HttpResponse(200, "OK", json.dumps({"result": {"status": "active"}}))
            return HttpResponse(200, "OK", json.dumps({"error": {"code": -32601, "message": "no method"}}))

    transport = JsonRpcTransport()
    qor = QorClient("http://localhost:8545", transport=transport)
    assert qor.get_rollup_status("r1") == {"status": "active"}
    assert transport.last_body["method"] == "qor_getRollupStatus"
    assert transport.last_body["params"] == ["r1"]
    with pytest.raises(RuntimeError):
        qor.get_da_blob_status("r1", 0)


def test_rest_anchor_decodes_wire_bytes():
    sr_hex = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d"
    vsh_hex = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
    transport = MockTransport(
        {
            ("GET", "/qorechain/multilayer/v1/anchor/L1"): {
                "anchor": {
                    "layer_id": "L1",
                    "layer_height": 42,
                    # base64-encoded proto bytes (jsonpb), as the chain serves them.
                    "state_root": base64.b64encode(bytes.fromhex(sr_hex)).decode(),
                    "validator_set_hash": base64.b64encode(bytes.fromhex(vsh_hex)).decode(),
                    "main_chain_height": 1000,
                    "anchored_at": 1700000000,
                    "pqc_aggregate_signature": base64.b64encode(b"\x01\x02\x03").decode(),
                    "transaction_count": 7,
                    "compressed_state_proof": "",
                }
            }
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    anchor = rest.get_anchor("L1")
    assert anchor.layer_id == "L1"
    assert anchor.layer_height == 42
    # Decoded back to hex regardless of the base64 wire encoding.
    assert anchor.state_root == sr_hex
    assert anchor.validator_set_hash == vsh_hex
    assert anchor.pqc_signature == "010203"
    assert anchor.transaction_count == 7
    # get_latest_anchor is an alias.
    assert rest.get_latest_anchor("L1").state_root == sr_hex


def test_rest_anchors_list_accepts_hex_wire():
    sr_hex = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d"
    transport = MockTransport(
        {
            ("GET", "/qorechain/multilayer/v1/anchors/L1"): {
                "anchors": [
                    {"layer_id": "L1", "layer_height": 1, "state_root": sr_hex},
                    {"layer_id": "L1", "layer_height": 2, "state_root": ""},
                ]
            }
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    anchors = rest.get_anchors("L1")
    assert [a.layer_height for a in anchors] == [1, 2]
    # A 64-char hex root is decoded as hex (no base64 hint), round-tripping to itself.
    assert anchors[0].state_root == sr_hex
    assert anchors[1].state_root == ""


def test_rest_pqc_account():
    pk_hex = "deadbeef" * 4
    transport = MockTransport(
        {
            ("GET", "/qorechain/pqc/v1/accounts/qor1abc"): {
                "account": {
                    "address": "qor1abc",
                    "public_key": base64.b64encode(bytes.fromhex(pk_hex)).decode(),
                    "algorithm_id": 3,
                    "algorithm_name": "ML-DSA-87",
                }
            }
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    acct = rest.get_pqc_account("qor1abc")
    assert acct.address == "qor1abc"
    assert acct.public_key == pk_hex
    assert acct.algorithm_id == 3
    assert acct.algorithm_name == "ML-DSA-87"


def test_rest_ai_reads():
    transport = MockTransport(
        {
            ("GET", "/qorechain/ai/v1/fee-estimate?urgency=high"): {"gas_price": "0.05uqor"},
            ("GET", "/qorechain/ai/v1/network/recommendations"): {"congestion": "low"},
            ("GET", "/qorechain/ai/v1/fraud/investigations/f1"): {"id": "f1", "status": "open"},
            ("GET", "/qorechain/ai/v1/circuit-breakers"): {"breakers": []},
        }
    )
    rest = RestClient("http://localhost:1317", transport=transport)
    assert rest.get_fee_estimate("high") == {"gas_price": "0.05uqor"}
    assert rest.get_network_recommendations() == {"congestion": "low"}
    assert rest.get_fraud_investigation("f1")["status"] == "open"
    assert rest.get_circuit_breakers() == {"breakers": []}


def test_rest_fraud_investigations_list_shapes():
    # investigations key
    t1 = MockTransport(
        {("GET", "/qorechain/ai/v1/fraud/investigations"): {"investigations": [{"id": "a"}]}}
    )
    assert RestClient("http://x", transport=t1).get_fraud_investigations() == [{"id": "a"}]
    # data key fallback
    t2 = MockTransport(
        {("GET", "/qorechain/ai/v1/fraud/investigations"): {"data": [{"id": "b"}]}}
    )
    assert RestClient("http://x", transport=t2).get_fraud_investigations() == [{"id": "b"}]


def test_jsonrpc_rl_methods():
    class RlTransport:
        def __init__(self):
            self.methods = []

        def __call__(self, method, url, headers=None, body=None):
            req = json.loads(body)
            self.methods.append(req["method"])
            return HttpResponse(200, "OK", json.dumps({"result": {"ok": req["method"]}}))

    transport = RlTransport()
    qor = QorClient("http://localhost:8545", transport=transport)
    assert qor.get_rl_agent_status() == {"ok": "qor_getRLAgentStatus"}
    assert qor.get_rl_observation() == {"ok": "qor_getRLObservation"}
    assert qor.get_rl_reward() == {"ok": "qor_getRLReward"}
    assert transport.methods == [
        "qor_getRLAgentStatus",
        "qor_getRLObservation",
        "qor_getRLReward",
    ]


def test_create_rdk_client_resolves_network():
    transport = MockTransport(
        {
            ("GET", "/qorechain/rdk/v1/params"): {
                "params": {
                    "max_rollups": 100,
                    "min_stake_for_rollup": "10000000000",
                    "rollup_creation_burn_rate": "0.01",
                    "default_challenge_window": 604800,
                    "max_da_blob_size": 2097152,
                    "blob_retention_blocks": 432000,
                    "max_batches_per_block": 10,
                }
            }
        }
    )
    client = create_rdk_client(network="mainnet", transport=transport)
    assert client.network.name == "mainnet"
    assert client.network.chain_id == "qorechain-vladi"
    assert client.params().max_rollups == 100


def test_rdk_client_endpoint_override():
    client = create_rdk_client(endpoints={"rest": "http://node:1317"})
    assert client.network.endpoints.rest == "http://node:1317"


def test_suggest_profile_advisory_and_fallback():
    class SuggestTransport:
        def __init__(self, result=None, error=False):
            self.result = result
            self.error = error

        def __call__(self, method, url, headers=None, body=None):
            if self.error:
                return HttpResponse(500, "err", "")
            return HttpResponse(200, "OK", json.dumps({"result": self.result}))

    client = create_rdk_client(transport=SuggestTransport(result={"profile": "gaming"}))
    s = client.suggest_profile("a fast game")
    assert s.profile.value == "gaming"
    assert s.source == "advisory"

    client2 = create_rdk_client(transport=SuggestTransport(error=True))
    s2 = client2.suggest_profile("anything")
    assert s2.profile.value == "defi"
    assert s2.source == "fallback"


def test_tx_client_broadcast_assembly(golden):
    """connect_tx + a mocked transport: account fetch, then SYNC broadcast."""
    captured = {}

    class TxTransport:
        def __call__(self, method, url, headers=None, body=None):
            if method == "GET" and "/cosmos/auth/v1beta1/accounts/" in url:
                return HttpResponse(
                    200, "OK", json.dumps({"account": {"account_number": "11", "sequence": "4"}})
                )
            if method == "POST" and "/cosmos/tx/v1beta1/txs" in url:
                captured["body"] = json.loads(body)
                return HttpResponse(
                    200, "OK", json.dumps({"tx_response": {"txhash": "ABC123", "code": 0, "raw_log": ""}})
                )
            return HttpResponse(404, "Not Found", "{}")

    from qorrdk import signer_from_private_key

    signer = signer_from_private_key(golden["privateKeyHex"])
    client = create_rdk_client(transport=TxTransport())
    tx = client.connect_tx(signer)
    result = tx.create_rollup(
        rollup_id="my-rollup", profile="defi", vm_type="evm", stake_amount=10000000000
    )
    assert result.tx_hash == "ABC123"
    assert result.code == 0
    # The broadcast carried a base64 TxRaw in SYNC mode.
    assert captured["body"]["mode"] == "BROADCAST_MODE_SYNC"
    tx_bytes = base64.b64decode(captured["body"]["tx_bytes"])
    from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxRaw

    tx_raw = TxRaw.FromString(tx_bytes)
    assert len(tx_raw.signatures) == 1
