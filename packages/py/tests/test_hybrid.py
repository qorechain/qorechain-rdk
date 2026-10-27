"""Hybrid (post-quantum) signing: golden vectors, key resolution, and the tx path."""

from __future__ import annotations

import base64
import hashlib
import json

import pytest
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw
from qorsdk.signbytes import clear_sign_bytes_cache

from qorrdk import (
    PauseRollupInput,
    RdkTxClient,
    TxOptions,
    create_rdk_client,
    derive_native_account,
    derive_pqc_canonical,
    derive_pqc_legacy,
    pause_rollup_msg,
    pqc_keypair_from_env,
    pqc_keypair_from_seed,
    resolve_pqc_keypair,
    signer_from_private_key,
)
from qorrdk.client.http import HttpResponse

REST = "http://rest.test"

#: The classical (no PQC keypair) TxRaw for the golden hybridTx inputs, as this
#: package built it before hybrid signing existed. It must never change.
CLASSICAL_TX_HEX = (
    "0a650a5e0a202f716f7265636861696e2e72646b2e76312e4d73675061757365526f6c6c7570"
    "123a0a2a716f723139726c34636d32686d7238616679346b6c6470787a33666b61346a677571"
    "3061677436373268120c726f6c6c2d766563746f7273120372646b12670a500a460a1f2f636f"
    "736d6f732e63727970746f2e736563703235366b312e5075624b657912230a21024f4e2ad99c"
    "34d60b9ba6283c9431a8418af8673212961f97a77b6377fcd05b6212040a020801180312130a"
    "0d0a0475716f721205333030303010c09a0c1a40df0a83cbe9e8f19ce7c7bafdca7f82386b9e"
    "9f9c6e00f1f20586f56b201fd92f03fef7527816ef465f3529a7cb0b2e84a231ef3983fe8ce0"
    "7f126b82778284a9"
)


class MockTransport:
    """Records requests and replays canned responses keyed by (method, path-substring)."""

    def __init__(self, routes=None, posts=None):
        self._routes = routes or {}
        self._posts = list(posts or [])
        self.calls = []

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append({"method": method, "url": url, "body": body})
        if method == "POST" and self._posts:
            return HttpResponse(200, "OK", json.dumps(self._posts.pop(0)))
        for (m, needle), payload in self._routes.items():
            if m == method and needle in url:
                return HttpResponse(200, "OK", json.dumps(payload))
        return HttpResponse(404, "Not Found", json.dumps({"code": 5, "message": "not found"}))

    def posted_txs(self):
        return [
            base64.b64decode(json.loads(c["body"])["tx_bytes"])
            for c in self.calls
            if c["method"] == "POST" and c["url"].endswith("/cosmos/tx/v1beta1/txs")
        ]


@pytest.fixture(autouse=True)
def _fresh_sign_bytes_cache():
    clear_sign_bytes_cache()
    yield
    clear_sign_bytes_cache()


@pytest.fixture(scope="module")
def keys(golden):
    account = derive_native_account(golden["mnemonic"])
    assert account.address == golden["nativeAddress"]
    return {
        "signer": signer_from_private_key(account.private_key),
        "canonical": derive_pqc_canonical(account.address, golden["mnemonic"]),
        "legacy": derive_pqc_legacy(golden["mnemonic"]),
    }


def _pause_msg(golden):
    m = golden["hybridTx"]["message"]
    assert m["typeUrl"] == "/qorechain.rdk.v1.MsgPauseRollup"
    return pause_rollup_msg(
        PauseRollupInput(creator=m["creator"], rollup_id=m["rollupId"], reason=m["reason"])
    )


def _golden_opts(golden) -> TxOptions:
    h = golden["hybridTx"]
    (coin,) = h["fee"]["amount"]
    return TxOptions(
        gas_limit=int(h["fee"]["gas"]),
        fee_amount=coin["amount"],
        fee_denom=coin["denom"],
        memo=h["memo"],
    )


def _diff_parts(got: bytes, want: bytes) -> str:
    """Name the TxRaw part that differs, for a readable failure."""
    g, w = TxRaw.FromString(got), TxRaw.FromString(want)
    parts = []
    gb, wb = TxBody.FromString(g.body_bytes), TxBody.FromString(w.body_bytes)
    if list(gb.messages) != list(wb.messages) or gb.memo != wb.memo:
        parts.append("body")
    if list(gb.extension_options) != list(wb.extension_options):
        parts.append("extension")
    if g.auth_info_bytes != w.auth_info_bytes:
        parts.append("authInfo")
    if list(g.signatures) != list(w.signatures):
        parts.append("signature")
    return ", ".join(parts) or "encoding"


@pytest.mark.parametrize(
    "case,version,with_key",
    [("v1", "v1", False), ("v1WithKey", "v1", True), ("v2", "v2", False), ("v2WithKey", "v2", True)],
)
def test_hybrid_tx_matches_golden_bytes(golden, keys, case, version, with_key):
    h = golden["hybridTx"]
    client = RdkTxClient(
        rest_url=REST,
        chain_id=h["chainId"],
        signer=keys["signer"],
        transport=MockTransport(),
        pqc_keypair=keys["canonical"],
        include_pqc_public_key=with_key,
        sign_bytes_version=version,
    )
    built = client.sign_hybrid_tx(
        [_pause_msg(golden)],
        account_number=h["accountNumber"],
        sequence=h["sequence"],
        opts=_golden_opts(golden),
        sign_bytes_version=version,
    )
    want = bytes.fromhex(h[case]["txRawHex"])
    assert built.pqc_signed_message.hex() == h[case]["pqcSignedMessageHex"]
    assert built.tx_raw_bytes == want, f"{case} differs in: {_diff_parts(built.tx_raw_bytes, want)}"
    assert built.sign_bytes_version == version

    # sign_tx takes the same path for a hybrid client (forced form: no network).
    assert (
        client.sign_tx(
            [_pause_msg(golden)],
            account_number=h["accountNumber"],
            sequence=h["sequence"],
            opts=_golden_opts(golden),
        )
        == want
    )


def test_client_without_pqc_keypair_builds_the_same_classical_tx(golden, keys):
    h = golden["hybridTx"]
    client = RdkTxClient(rest_url=REST, chain_id=h["chainId"], signer=keys["signer"])
    assert not client.is_hybrid
    tx = client.sign_tx(
        [_pause_msg(golden)],
        account_number=h["accountNumber"],
        sequence=h["sequence"],
        opts=_golden_opts(golden),
    )
    assert tx.hex() == CLASSICAL_TX_HEX
    raw = TxRaw.FromString(tx)
    assert len(TxBody.FromString(raw.body_bytes).extension_options) == 0


def test_auto_resolves_v1_and_v2_through_the_transport(golden, keys):
    h = golden["hybridTx"]

    def client_for(transport):
        return RdkTxClient(
            rest_url=REST,
            chain_id=h["chainId"],
            signer=keys["signer"],
            transport=transport,
            pqc_keypair=keys["canonical"],
        )

    not_applied = MockTransport({("GET", "/cosmos/upgrade/v1beta1/applied_plan/"): {"height": "0"}})
    assert client_for(not_applied).resolve_sign_bytes_version() == "v1"
    assert [c["url"] for c in not_applied.calls] == [
        f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0",
        f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98",
    ]

    clear_sign_bytes_cache()
    applied = MockTransport({("GET", "/applied_plan/v3.1.98"): {"height": "123"}, ("GET", "/applied_plan/v3.2.0"): {"height": "0"}})
    assert client_for(applied).resolve_sign_bytes_version() == "v2"

    # An unreachable node is an error, never a guess.
    clear_sign_bytes_cache()
    with pytest.raises(Exception, match="sign_bytes_version"):
        client_for(MockTransport()).resolve_sign_bytes_version()


def test_hybrid_broadcast_signs_with_account_state_and_resolved_form(golden, keys):
    h = golden["hybridTx"]
    transport = MockTransport(
        {
            ("GET", "/cosmos/auth/v1beta1/accounts/"): {
                "account": {"account_number": str(h["accountNumber"]), "sequence": str(h["sequence"])}
            },
            ("GET", "/applied_plan/"): {"height": "0"},
        },
        posts=[{"tx_response": {"txhash": "ABC", "code": 0, "raw_log": ""}}],
    )
    client = RdkTxClient(
        rest_url=REST,
        chain_id=h["chainId"],
        signer=keys["signer"],
        transport=transport,
        pqc_keypair=keys["canonical"],
    )
    result = client.pause_rollup(rollup_id="roll-vectors", reason="", opts=_golden_opts(golden))
    assert result.code == 0 and result.tx_hash == "ABC"
    assert transport.posted_txs() == [bytes.fromhex(h["v1"]["txRawHex"])]


def test_hybrid_broadcast_retries_once_after_a_pqc_refusal(golden, keys):
    h = golden["hybridTx"]
    refused = {"tx_response": {"txhash": "X", "code": 21, "codespace": "pqc", "raw_log": "hybrid PQC signature verification failed"}}
    transport = MockTransport(
        {
            ("GET", "/cosmos/auth/v1beta1/accounts/"): {
                "account": {"account_number": str(h["accountNumber"]), "sequence": str(h["sequence"])}
            },
            ("GET", "/applied_plan/"): {"height": "0"},
        },
        posts=[refused, {"tx_response": {"txhash": "OK", "code": 0}}],
    )
    client = RdkTxClient(
        rest_url=REST, chain_id=h["chainId"], signer=keys["signer"], transport=transport,
        pqc_keypair=keys["canonical"],
    )
    result = client.pause_rollup(rollup_id="roll-vectors", reason="", opts=_golden_opts(golden))
    assert result.tx_hash == "OK"
    assert len(transport.posted_txs()) == 2

    # A forced form is never retried.
    transport = MockTransport(
        {("GET", "/cosmos/auth/v1beta1/accounts/"): {"account": {"account_number": "7", "sequence": "3"}}},
        posts=[refused, {"tx_response": {"txhash": "OK", "code": 0}}],
    )
    client = RdkTxClient(
        rest_url=REST, chain_id=h["chainId"], signer=keys["signer"], transport=transport,
        pqc_keypair=keys["canonical"], sign_bytes_version="v2",
    )
    result = client.pause_rollup(rollup_id="roll-vectors", reason="", opts=_golden_opts(golden))
    assert result.code == 21
    assert transport.posted_txs() == [bytes.fromhex(h["v2"]["txRawHex"])]


def test_pre_broadcast_rule_checks_still_run_before_hybrid_signing(keys):
    transport = MockTransport()
    client = RdkTxClient(
        rest_url=REST, chain_id="qorechain-diana", signer=keys["signer"], transport=transport,
        pqc_keypair=keys["canonical"], sign_bytes_version="v2",
    )
    with pytest.raises(ValueError):
        client.create_rollup(rollup_id="Bad Id!", profile="defi", vm_type="evm", stake_amount=1)
    assert transport.calls == []


def test_constructor_validation(keys):
    with pytest.raises(ValueError, match="sign_bytes_version"):
        RdkTxClient(rest_url=REST, chain_id="c", signer=keys["signer"], sign_bytes_version="v3")
    from qorrdk import MockTxClient

    with pytest.raises(ValueError, match="backend"):
        RdkTxClient(backend=MockTxClient(address="qor1x"), pqc_keypair=keys["canonical"])


def test_connect_tx_passes_hybrid_options(keys):
    client = create_rdk_client(network="testnet", transport=MockTransport())
    tx = client.connect_tx(
        keys["signer"], pqc_keypair=keys["canonical"], include_pqc_public_key=True, sign_bytes_version="v1"
    )
    assert tx.is_hybrid
    assert tx.resolve_sign_bytes_version() == "v1"
    assert not client.connect_tx(keys["signer"]).is_hybrid


# --------------------------------------------------------------------------- #
# Key resolution (mirrors the TS resolvePqcKeypair / pqcKeypairFromEnv).
# --------------------------------------------------------------------------- #


def _rdk_with_registered(address: str, public_key: bytes | None):
    routes = {}
    if public_key is not None:
        routes[("GET", f"/qorechain/pqc/v1/account/{address}")] = {
            "account": {
                "address": address,
                "public_key": base64.b64encode(public_key).decode("ascii"),
                "algorithm_id": 1,
                "algorithm_name": "dilithium5",
            }
        }
    return create_rdk_client(network="testnet", endpoints={"rest": REST}, transport=MockTransport(routes))


def test_resolve_not_registered_returns_canonical_and_embeds(golden, keys):
    address = golden["nativeAddress"]
    r = resolve_pqc_keypair(_rdk_with_registered(address, None), address, golden["mnemonic"])
    assert r.derivation == "canonical"
    assert r.keypair == keys["canonical"]
    assert r.registered is False
    assert r.include_pqc_public_key is True


def test_resolve_registered_canonical(golden, keys):
    address = golden["nativeAddress"]
    client = _rdk_with_registered(address, keys["canonical"].public_key)
    r = resolve_pqc_keypair(client, address, golden["mnemonic"])
    assert (r.derivation, r.registered, r.include_pqc_public_key) == ("canonical", True, False)
    assert r.keypair == keys["canonical"]


def test_resolve_registered_legacy(golden, keys):
    address = golden["nativeAddress"]
    client = _rdk_with_registered(address, keys["legacy"].public_key)
    r = resolve_pqc_keypair(client, address, golden["mnemonic"])
    assert (r.derivation, r.registered, r.include_pqc_public_key) == ("legacy", True, False)
    assert r.keypair == keys["legacy"]
    assert keys["legacy"].public_key != keys["canonical"].public_key


def test_resolve_foreign_key_raises(golden):
    address = golden["nativeAddress"]
    foreign = pqc_keypair_from_seed(bytes(range(32))).public_key
    client = _rdk_with_registered(address, foreign)
    with pytest.raises(ValueError, match="neither the canonical nor the legacy"):
        resolve_pqc_keypair(client, address, golden["mnemonic"])


def test_env_seed_matches_the_canonical_derivation(golden, keys):
    # The canonical key IS the seeded keygen of shake256("qorechain:pqc:v1|" + address + "|" + mnemonic).
    address = golden["nativeAddress"]
    seed = hashlib.shake_256(f"qorechain:pqc:v1|{address}|{golden['mnemonic']}".encode()).digest(32)
    env = {"QORE_PQC_SEED_HEX": seed.hex(), "QORE_MNEMONIC": "ignored when a seed is set"}

    r = pqc_keypair_from_env(_rdk_with_registered(address, None), address, env)
    assert (r.derivation, r.registered, r.include_pqc_public_key) == ("seed", False, True)
    assert r.keypair == keys["canonical"]

    r = pqc_keypair_from_env(_rdk_with_registered(address, keys["canonical"].public_key), address, env)
    assert (r.derivation, r.registered, r.include_pqc_public_key) == ("seed", True, False)


def test_env_seed_mismatch_raises(golden, keys):
    address = golden["nativeAddress"]
    env = {"QORE_PQC_SEED_HEX": bytes(range(32)).hex()}
    with pytest.raises(ValueError, match="does not produce the post-quantum key registered"):
        pqc_keypair_from_env(_rdk_with_registered(address, keys["canonical"].public_key), address, env)


def test_env_seed_must_be_32_bytes(golden):
    address = golden["nativeAddress"]
    with pytest.raises(ValueError, match="32 bytes, got 31"):
        pqc_keypair_from_env(_rdk_with_registered(address, None), address, {"QORE_PQC_SEED_HEX": "00" * 31})


def test_env_mnemonic_and_none(golden, keys):
    address = golden["nativeAddress"]
    client = _rdk_with_registered(address, keys["legacy"].public_key)
    r = pqc_keypair_from_env(client, address, {"QORE_MNEMONIC": f"  {golden['mnemonic']}  "})
    assert r.derivation == "legacy" and r.keypair == keys["legacy"]
    assert pqc_keypair_from_env(client, address, {}) is None
    assert pqc_keypair_from_env(client, address, {"QORE_PQC_SEED_HEX": " ", "QORE_MNEMONIC": ""}) is None
