"""REST and JSON-RPC clients with a mocked transport."""

from __future__ import annotations

import base64
import json

import pytest

from qorechain_rdk import RestClient, create_rdk_client
from qorechain_rdk.client.http import HttpResponse
from qorechain_rdk.client.jsonrpc import QorClient


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

    from qorechain_rdk import signer_from_private_key

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
