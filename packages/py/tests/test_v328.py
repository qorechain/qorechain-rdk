"""Chain v3.2.7 / v3.2.8 support against the vectors in ``v328.json``, which come
from the chain's own code (inbox, envelope) and its ``tx.proto`` (message bytes)."""

from __future__ import annotations

import hashlib
import json
import struct

import pytest

from qorrdk import (
    BLS12_381_SCALAR_MODULUS,
    PRESET_DEFAULTS,
    CreateRollupInput,
    EnvelopeError,
    EnvelopeRecipient,
    HttpResponse,
    MockTxClient,
    ProfileName,
    RdkTxClient,
    RestClient,
    RollupConfig,
    SubmitBatchInput,
    bond_rollup_submitter_msg,
    create_rollup_msg,
    data_hash_error,
    decode_rdk_tx_error,
    deposit_to_rollup_msg,
    envelope_membership_error,
    inbox_accumulate,
    inbox_range_hash,
    is_canonical_scalar,
    is_data_hash_chain_bound,
    is_proof_compatible,
    kem_key_fingerprint,
    kem_keypair_from_seed,
    map_batch_view,
    map_params_view,
    map_rollup_view,
    open_envelope,
    parse_envelope,
    post_rollup_data_msg,
    posted_data_hash,
    presets,
    register_kem_key_msg,
    rollup_mode_errors,
    seal_envelope,
    set_rollup_members_msg,
    set_rollup_sequencing_msg,
    set_verification_key_msg,
    submit_batch_msg,
    to_canonical_scalar,
    unbond_rollup_submitter_msg,
    update_verification_key_msg,
    validate_rollup_config,
    zk_public_input_errors,
)
from qorrdk.tx import SetVerificationKeyInput, codecs


# --------------------------------------------------------------------------- #
# Message bytes match the chain's tx.proto.
# --------------------------------------------------------------------------- #


def test_create_rollup_carries_fields_6_to_9(v328):
    msg = create_rollup_msg(
        CreateRollupInput(
            creator="qor1creator",
            rollup_id="my-rollup",
            profile="nft",
            vm_type="native",
            stake_amount=10_000_000_000,
            verification_key=bytes([9, 8, 7]),
            sequencing="based",
            execution_vm="qledger-v1",
            privacy="encapsulated",
        )
    )
    assert msg.value.hex() == v328["msgProtoHex"]["MsgCreateRollupV328"]


def test_submit_batch_carries_inbox_end(v328):
    msg = submit_batch_msg(
        SubmitBatchInput(
            sequencer="qor1seq",
            rollup_id="r1",
            batch_index=7,
            state_root=bytes([1, 2, 3]),
            tx_count=42,
            data_hash=bytes([9, 9]),
            inbox_end=300,
        )
    )
    assert msg.value.hex() == v328["msgProtoHex"]["MsgSubmitBatchV328"]


def _new_messages():
    return [
        (
            "MsgSetVerificationKey",
            set_verification_key_msg(
                SetVerificationKeyInput(
                    creator="qor1creator",
                    rollup_id="r1",
                    verification_key="01020304",
                    proof_system="snark",
                )
            ),
            "/qorechain.rdk.v1.MsgSetVerificationKey",
        ),
        (
            "MsgUpdateVerificationKey",
            update_verification_key_msg(
                authority="qor1gov", rollup_id="r1", verification_key="0506", proof_system="snark"
            ),
            "/qorechain.rdk.v1.MsgUpdateVerificationKey",
        ),
        (
            "MsgPostRollupData",
            post_rollup_data_msg(poster="qor1poster", rollup_id="r1", data=b"hello"),
            "/qorechain.rdk.v1.MsgPostRollupData",
        ),
        (
            "MsgSetRollupSequencing",
            set_rollup_sequencing_msg(authority="qor1gov", rollup_id="r1", sequencing="based"),
            "/qorechain.rdk.v1.MsgSetRollupSequencing",
        ),
        (
            "MsgDepositToRollup",
            deposit_to_rollup_msg(
                depositor="qor1dep", rollup_id="r1", account="00" * 31 + "01", amount=1_000_000
            ),
            "/qorechain.rdk.v1.MsgDepositToRollup",
        ),
        (
            "MsgBondRollupSubmitter",
            bond_rollup_submitter_msg(submitter="qor1sub", rollup_id="r1", amount=1_000_000_000),
            "/qorechain.rdk.v1.MsgBondRollupSubmitter",
        ),
        (
            "MsgUnbondRollupSubmitter",
            unbond_rollup_submitter_msg(submitter="qor1sub", rollup_id="r1"),
            "/qorechain.rdk.v1.MsgUnbondRollupSubmitter",
        ),
        (
            "MsgSetRollupMembers",
            set_rollup_members_msg(creator="qor1creator", rollup_id="r1", members=["qor1a", "qor1b"]),
            "/qorechain.rdk.v1.MsgSetRollupMembers",
        ),
        (
            "MsgRegisterKEMKey",
            register_kem_key_msg(sender="qor1member", public_key="01020304"),
            "/qorechain.pqc.v1.MsgRegisterKEMKey",
        ),
    ]


@pytest.mark.parametrize("name", [m[0] for m in _new_messages()])
def test_new_message_bytes(v328, name):
    _, msg, type_url = next(m for m in _new_messages() if m[0] == name)
    assert msg.type_url == type_url
    assert msg.value.hex() == v328["msgProtoHex"][name]


def test_every_fixture_message_is_covered(v328):
    covered = {m[0] for m in _new_messages()} | {
        "MsgCreateRollupV328",
        "MsgSubmitBatchV328",
        "MsgPostRollupDataResponse",
    }
    assert set(v328["msgProtoHex"]) == covered


def test_decodes_post_rollup_data_response_and_round_trips(v328):
    r = codecs.MsgPostRollupDataResponse.decode(
        bytes.fromhex(v328["msgProtoHex"]["MsgPostRollupDataResponse"])
    )
    assert r.sequence == 5
    assert r.data_hash.hex() == "aabb"
    m = set_rollup_members_msg(creator="c", rollup_id="r", members=["a", "b"])
    back = codecs.MsgSetRollupMembers.decode(m.value)
    assert (back.creator, back.rollup_id, back.members) == ("c", "r", ["a", "b"])
    k = codecs.MsgRegisterKEMKey.decode(bytes.fromhex(v328["msgProtoHex"]["MsgRegisterKEMKey"]))
    assert (k.sender, k.algorithm_id, k.public_key.hex()) == ("qor1member", 2, "01020304")


# --------------------------------------------------------------------------- #
# Rollup inbox.
# --------------------------------------------------------------------------- #


def test_inbox_accumulator_and_range_commitments_match_the_chain(v328):
    inbox = v328["inbox"]
    chain_id, rollup_id = inbox["chainId"], inbox["rollupId"]
    acc = b""
    accs = []
    for p in inbox["posts"]:
        assert posted_data_hash(bytes.fromhex(p["dataHex"])).hex() == p["dataHash"]
        acc = inbox_accumulate(
            chain_id=chain_id,
            rollup_id=rollup_id,
            prev_acc=acc,
            sequence=p["sequence"],
            height=p["height"],
            poster=p["poster"],
            data_hash=p["dataHash"],
        )
        assert acc.hex() == p["acc"]
        accs.append(acc)
    r03 = inbox_range_hash(
        chain_id=chain_id, rollup_id=rollup_id, from_sequence=0, to_sequence=3,
        acc_from=b"", acc_to=accs[2],
    )
    assert r03.hex() == inbox["range_0_3"]
    r13 = inbox_range_hash(
        chain_id=chain_id, rollup_id=rollup_id, from_sequence=1, to_sequence=3,
        acc_from=accs[0], acc_to=accs[2],
    )
    assert r13.hex() == inbox["range_1_3"]


# --------------------------------------------------------------------------- #
# Canonical ZK inputs.
# --------------------------------------------------------------------------- #


def test_classifies_and_reduces_against_the_scalar_modulus(v328):
    assert f"{BLS12_381_SCALAR_MODULUS:064x}" == v328["zk"]["modulus"]
    for c in v328["zk"]["cases"]:
        assert is_canonical_scalar(c["value"]) is c["canonical"], c["value"]
        assert to_canonical_scalar(c["value"]).hex() == c["reduced"]


def test_names_each_refused_input_and_skips_a_chain_bound_data_hash():
    high = "ff" * 32
    ok = "00" * 31 + "01"
    assert zk_public_input_errors(prev_state_root=ok, state_root=ok, data_hash=ok) == []
    assert len(zk_public_input_errors(state_root=high, data_hash=high, withdrawals_root=high)) == 2
    assert zk_public_input_errors(state_root=ok, data_hash=high, data_hash_bound=True) == []
    assert zk_public_input_errors(state_root=ok, withdrawals_root="") == []
    assert is_data_hash_chain_bound({"da_backend": "celestia", "sequencing": "based"}) is True
    assert is_data_hash_chain_bound({"da_backend": "native"}, high) is True
    assert is_data_hash_chain_bound({"da_backend": "native"}, "") is False
    assert is_data_hash_chain_bound({"da_backend": "celestia"}, high) is False


# --------------------------------------------------------------------------- #
# Private-rollup envelopes.
# --------------------------------------------------------------------------- #


def _recipients(p):
    return [
        EnvelopeRecipient(m["member"], kem_keypair_from_seed(m["seed"])[0]) for m in p["members"]
    ]


def test_opens_the_chains_envelope_as_each_member(v328):
    p = v328["privpost"]
    env = parse_envelope(p["envelope"])
    assert env.epoch == p["epoch"]
    assert [e.member for e in env.entries] == [m["member"] for m in p["members"]]
    for m in p["members"]:
        public_key, _ = kem_keypair_from_seed(m["seed"])
        assert kem_key_fingerprint(public_key).hex() == m["ekSha256"]
        out = open_envelope(
            envelope=p["envelope"], chain_id=p["chainId"], rollup_id=p["rollupId"],
            member=m["member"], decapsulation_key=m["seed"],
        )
        assert out.hex() == p["plaintextHex"]
    # The expanded 3168-byte secret key opens it too.
    m = p["members"][1]
    out = open_envelope(
        envelope=p["envelope"], chain_id=p["chainId"], rollup_id=p["rollupId"],
        member=m["member"], decapsulation_key=kem_keypair_from_seed(m["seed"])[1],
    )
    assert out.hex() == p["plaintextHex"]


def _test_random():
    """Byte ``i`` is byte ``i mod 32`` of SHA-256("qorechain-rdk-test-rand" || be64(i // 32))."""
    n = 0

    def random(length: int) -> bytes:
        nonlocal n
        out = bytearray()
        for _ in range(length):
            blk = hashlib.sha256(b"qorechain-rdk-test-rand" + struct.pack(">Q", n // 32)).digest()
            out.append(blk[n % 32])
            n += 1
        return bytes(out)

    return random


def test_seals_byte_for_byte_as_the_chain_does(v328):
    p = v328["privpost"]
    env = seal_envelope(
        chain_id=p["chainId"], rollup_id=p["rollupId"], epoch=p["epoch"],
        recipients=_recipients(p), plaintext=bytes.fromhex(p["plaintextHex"]),
        random=_test_random(),
    )
    assert hashlib.sha256(env).hexdigest() == p["envelopeSha256"]
    assert env.hex() == p["envelope"]


def test_refuses_wrong_member_rollup_or_tamper_and_mirrors_membership(v328):
    p = v328["privpost"]
    m = p["members"][0]

    def open_(**over):
        args = dict(
            envelope=p["envelope"], chain_id=p["chainId"], rollup_id=p["rollupId"],
            member=m["member"], decapsulation_key=m["seed"],
        )
        args.update(over)
        return open_envelope(**args)

    with pytest.raises(EnvelopeError, match="no entry"):
        open_(member="qor1nobody")
    with pytest.raises(EnvelopeError, match="does not open"):
        open_(rollup_id="other")
    tampered = bytearray.fromhex(p["envelope"])
    tampered[-1] ^= 1
    with pytest.raises(EnvelopeError, match="does not open"):
        open_(envelope=bytes(tampered))
    with pytest.raises(EnvelopeError, match="malformed"):
        parse_envelope(bytes.fromhex(p["envelope"])[:100])

    recipients = _recipients(p)
    pt = bytes.fromhex(p["plaintextHex"])
    fresh = seal_envelope(
        chain_id=p["chainId"], rollup_id=p["rollupId"], epoch=1, recipients=recipients, plaintext=pt
    )
    assert envelope_membership_error(fresh, members_epoch=1, members=recipients) is None
    assert "epoch" in envelope_membership_error(fresh, members_epoch=2, members=recipients)
    assert "entry 0" in envelope_membership_error(
        fresh, members_epoch=1, members=list(reversed(recipients))
    )
    assert "2 entries" in envelope_membership_error(fresh, members_epoch=1, members=recipients[:1])
    assert "no members" in envelope_membership_error(fresh, members_epoch=1, members=[])


# --------------------------------------------------------------------------- #
# Configuration rules.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", [ProfileName.NFT, ProfileName.CUSTOM])
def test_optimistic_presets_run_qledger_v1_and_are_based(name):
    assert PRESET_DEFAULTS[name]["execution_vm"] == "qledger-v1"
    assert PRESET_DEFAULTS[name]["sequencing"] == "based"
    cfg = RollupConfig(rollup_id="my-rollup", **PRESET_DEFAULTS[name])
    assert validate_rollup_config(cfg).errors == []
    builder = getattr(presets, name.value)("my-rollup")
    msg = builder.to_create_msg("qor1c", stake_amount="1")
    assert msg.execution_vm == "qledger-v1"
    assert msg.sequencing == "based"


def test_refuses_an_optimistic_rollup_without_an_execution_vm_and_stark():
    cfg = presets.custom("my-rollup").set(execution_vm="", sequencing="").get()
    assert validate_rollup_config(cfg).valid is False
    assert is_proof_compatible("zk", "stark") is False
    stark = presets.defi("my-rollup").set(proof_system="stark").get()
    assert "paused" in ",".join(validate_rollup_config(stark).errors)


def test_mirrors_the_chains_sequencing_execution_vm_and_privacy_matrix():
    assert rollup_mode_errors(
        settlement="zk", proof_system="snark", sequencing="based", privacy="encapsulated"
    ) == []
    assert rollup_mode_errors(settlement="based", proof_system="none", sequencing="based") == []
    assert len(
        rollup_mode_errors(settlement="sovereign", proof_system="none", sequencing="based")
    ) == 1
    assert "optimistic" in ",".join(
        rollup_mode_errors(
            settlement="zk", proof_system="snark", execution_vm="qledger-v1", sequencing="based"
        )
    )
    assert "based" in ",".join(
        rollup_mode_errors(settlement="optimistic", proof_system="fraud", execution_vm="qledger-v1")
    )
    assert rollup_mode_errors(
        settlement="optimistic", proof_system="fraud", execution_vm="qledger-v1",
        sequencing="based", privacy="encapsulated",
    )
    assert "private rollup" in ",".join(
        rollup_mode_errors(settlement="based", proof_system="none", privacy="encapsulated")
    )
    assert "not valid" in ",".join(
        rollup_mode_errors(settlement="zk", proof_system="snark", sequencing="shared")
    )


def test_lets_a_native_data_hash_through_once_posted_data_is_on():
    assert data_hash_error("native", "ab") is not None
    assert data_hash_error("native", "ab", posted_data_enabled=True) is None


def test_names_the_v328_refusals():
    assert decode_rdk_tx_error(48, "rdk").kind == "invalid_rollup_mode"
    assert decode_rdk_tx_error(52, "rdk").kind == "stark_statement_unsupported"
    assert decode_rdk_tx_error(46, "rdk").kind == "invalid_inbox_range"
    assert decode_rdk_tx_error(37, "rdk").kind == "verification_key_disabled"
    assert decode_rdk_tx_error(54, "rdk").kind == "deposit_pool_not_empty"
    decoded = decode_rdk_tx_error(42, "rdk")
    assert decoded.hint == "see max_posted_data_bytes"
    assert decoded.message.endswith("(see max_posted_data_bytes)")
    assert decode_rdk_tx_error(999, "rdk", "raw").kind != "invalid_rollup_mode"


# --------------------------------------------------------------------------- #
# Client methods and pre-checks.
# --------------------------------------------------------------------------- #


def test_create_rollup_checks_modes_against_the_profile():
    mock = MockTxClient(address="qor1creator")
    tx = RdkTxClient.from_backend(mock)
    with pytest.raises(ValueError, match="would be refused"):
        tx.create_rollup(rollup_id="my-rollup", profile="nft", vm_type="native", stake_amount=1)
    assert mock.calls == []
    assert tx.create_rollup(
        rollup_id="my-rollup", profile="nft", vm_type="native", stake_amount=1,
        execution_vm="qledger-v1", sequencing="based",
    ).code == 0
    assert b"qledger-v1" in mock.calls[0].messages[0].value


def test_tx_methods_refuse_what_the_chain_would():
    mock = MockTxClient(address="qor1me")
    tx = RdkTxClient.from_backend(mock)
    with pytest.raises(ValueError, match="STARK"):
        tx.set_verification_key(rollup_id="r1", verification_key="01", proof_system="stark")
    with pytest.raises(ValueError, match="empty"):
        tx.post_rollup_data(rollup_id="r1", data=b"")
    with pytest.raises(ValueError, match="32-byte"):
        tx.deposit_to_rollup(rollup_id="r1", account="00" * 32, amount=1_000_000)
    with pytest.raises(ValueError, match="32-byte"):
        tx.deposit_to_rollup(rollup_id="r1", account="01" * 31, amount=1_000_000)
    with pytest.raises(ValueError, match="at least"):
        tx.deposit_to_rollup(rollup_id="r1", account="00" * 31 + "01", amount=999_999)
    with pytest.raises(ValueError, match="positive"):
        tx.bond_rollup_submitter(rollup_id="r1", amount=0)
    with pytest.raises(ValueError, match="1 to 32"):
        tx.set_rollup_members(rollup_id="r1", members=[])
    with pytest.raises(ValueError, match="1 to 32"):
        tx.set_rollup_members(rollup_id="r1", members=[f"qor1m{i}" for i in range(33)])
    with pytest.raises(ValueError, match="twice"):
        tx.set_rollup_members(rollup_id="r1", members=["qor1a", "qor1a"])
    with pytest.raises(ValueError, match="1568"):
        tx.register_kem_key(public_key="0102")
    assert mock.calls == []

    tx.set_verification_key(rollup_id="r1", verification_key="01", proof_system="snark")
    tx.post_rollup_data(rollup_id="r1", data=b"x")
    tx.deposit_to_rollup(rollup_id="r1", account="00" * 31 + "01", amount=1_000_000)
    tx.bond_rollup_submitter(rollup_id="r1", amount=5)
    tx.unbond_rollup_submitter(rollup_id="r1")
    tx.set_rollup_members(rollup_id="r1", members=["qor1a", "qor1b"])
    tx.register_kem_key(public_key=bytes(1568))
    assert [c.messages[0].type_url for c in mock.calls] == [
        "/qorechain.rdk.v1.MsgSetVerificationKey",
        "/qorechain.rdk.v1.MsgPostRollupData",
        "/qorechain.rdk.v1.MsgDepositToRollup",
        "/qorechain.rdk.v1.MsgBondRollupSubmitter",
        "/qorechain.rdk.v1.MsgUnbondRollupSubmitter",
        "/qorechain.rdk.v1.MsgSetRollupMembers",
        "/qorechain.pqc.v1.MsgRegisterKEMKey",
    ]


class _Node:
    """A REST transport serving one rollup, protocol features and KEM keys."""

    def __init__(self, rollup: dict, features=(), kem_keys=None):
        self.rollup = rollup
        self.features = list(features)
        self.kem_keys = kem_keys or {}
        self.urls: list[str] = []
        self.posted = False

    def __call__(self, method, url, headers=None, body=None):
        self.urls.append(url)
        if "/qorechain/rdk/v1/rollup/" in url:
            return HttpResponse(200, "OK", json.dumps({"rollup": self.rollup}))
        if url.endswith("/qorechain/pqc/v1/protocol_features"):
            feats = [{"name": f, "enabled": True} for f in self.features]
            return HttpResponse(200, "OK", json.dumps({"features": feats}))
        if "/qorechain/pqc/v1/kem/" in url:
            addr = url.rsplit("/", 1)[1]
            key = self.kem_keys.get(addr)
            return HttpResponse(
                200, "OK", json.dumps({"found": key is not None, "key": key or {}})
            )
        if "/cosmos/auth/v1beta1/accounts/" in url:
            return HttpResponse(
                200, "OK", json.dumps({"account": {"account_number": "1", "sequence": "0"}})
            )
        if method == "POST" and url.endswith("/cosmos/tx/v1beta1/txs"):
            self.posted = True
            return HttpResponse(
                200, "OK", json.dumps({"tx_response": {"txhash": "H", "code": 0, "raw_log": ""}})
            )
        return HttpResponse(404, "Not Found", "{}")


def _tx(node, golden):
    from qorrdk import signer_from_private_key

    return RdkTxClient(
        rest_url="http://node",
        chain_id="qorechain-diana",
        signer=signer_from_private_key(golden["privateKeyHex"]),
        transport=node,
    )


def _batch(**over):
    b = {"rollup_id": "r1", "batch_index": 3, "state_root": "00" * 31 + "01", "tx_count": 1,
         "data_hash": ""}
    b.update(over)
    return b


def test_submit_batch_prechecks_a_based_rollup(golden):
    node = _Node({"rollup_id": "r1", "sequencing": "based", "da_backend": "native",
                  "settlement_mode": "based"})
    tx = _tx(node, golden)
    with pytest.raises(ValueError, match="set inbox_end"):
        tx.submit_batch(_batch())
    assert tx.submit_batch(_batch(inbox_end=3, data_hash="ab" * 32)).code == 0
    assert node.posted


def test_submit_batch_prechecks_a_rollup_that_is_not_based(golden):
    node = _Node({"rollup_id": "r1", "da_backend": "native", "settlement_mode": "optimistic"})
    tx = _tx(node, golden)
    with pytest.raises(ValueError, match="inbox_end must be 0"):
        tx.submit_batch(_batch(inbox_end=2))
    with pytest.raises(ValueError, match="must be empty"):
        tx.submit_batch(_batch(data_hash="ab"))
    node.features = ["rdk-post-rollup-data"]
    assert tx.submit_batch(_batch(data_hash="ab" * 32)).code == 0


def test_submit_batch_prechecks_zk_inputs_and_paused_stark(golden):
    node = _Node(
        {"rollup_id": "r1", "da_backend": "celestia", "settlement_mode": "zk",
         "proof_system": "snark"},
        features=["rdk-zk-canonical-inputs"],
    )
    tx = _tx(node, golden)
    with pytest.raises(ValueError, match="state_root is not a canonical"):
        tx.submit_batch(_batch(state_root="ff" * 32))
    assert node.posted is False
    node.rollup["proof_system"] = "stark"
    node.features = ["rdk-stark-statement"]
    with pytest.raises(ValueError, match="STARK settlement is paused"):
        tx.submit_batch(_batch())


# --------------------------------------------------------------------------- #
# Views and REST.
# --------------------------------------------------------------------------- #


def test_views_read_the_v328_fields():
    r = map_rollup_view(
        {"sequencing": "based", "execution_vm": "qledger-v1", "privacy": "",
         "members": ["qor1a", "qor1b"], "members_epoch": "4", "deposit_pool": "7"}
    )
    assert (r.sequencing, r.execution_vm, r.members, r.members_epoch, r.deposit_pool) == (
        "based", "qledger-v1", ["qor1a", "qor1b"], 4, "7",
    )
    old = map_rollup_view({})
    assert (old.sequencing, old.members, old.members_epoch, old.deposit_pool) == ("", [], 0, "0")
    b = map_batch_view({"inboxStart": "2", "inbox_end": "9", "withdrawals_root_reduced": True})
    assert (b.inbox_start, b.inbox_end, b.withdrawals_root_reduced) == (2, 9, True)
    assert map_batch_view({}).withdrawals_root_reduced is False
    p = map_params_view({"max_posted_data_bytes": "65536", "min_submitter_bond": "1000000000"})
    assert p.max_posted_data_bytes == 65536
    assert p.min_submitter_bond == "1000000000"
    assert p.posted_data_fee_per_byte is None


def test_rest_inbox_posted_data_and_bond_routes():
    seen = []

    def transport(method, url, headers=None, body=None):
        seen.append(url)
        if "/inbox/" in url:
            return HttpResponse(200, "OK", json.dumps({"inbox": {
                "rollup_id": "r1", "sequencing": "based", "head_sequence": "5",
                "consumed_sequence": "2", "range_end": "5", "range_data_hash": "abcd"}}))
        if "/posted_data/" in url:
            return HttpResponse(200, "OK", json.dumps({"posted_data": {
                "rollup_id": "r1", "sequence": "3", "size": "10", "height": "77"}}))
        if "/submitter_bond/" in url:
            return HttpResponse(200, "OK", json.dumps({
                "amount": "1000000000", "last_submit_time": "100", "unbond_after": "200",
                "pending": "3"}))
        return HttpResponse(404, "Not Found", "{}")

    rest = RestClient("http://node", transport)
    inbox = rest.get_inbox("r1")
    assert (inbox.head_sequence, inbox.consumed_sequence, inbox.range_data_hash) == (5, 2, "abcd")
    rest.get_inbox("r1", 5)
    posted = rest.get_posted_data("r1", 3)
    assert (posted.sequence, posted.size, posted.height) == (3, 10, 77)
    bond = rest.get_submitter_bond("r1", "qor1sub")
    assert (bond.amount, bond.unbond_after, bond.pending) == ("1000000000", 200, 3)
    assert seen == [
        "http://node/qorechain/rdk/v1/inbox/r1",
        "http://node/qorechain/rdk/v1/inbox/r1?inbox_end=5",
        "http://node/qorechain/rdk/v1/posted_data/r1/3",
        "http://node/qorechain/rdk/v1/submitter_bond/r1/qor1sub",
    ]


def test_rest_kem_keys_and_private_rollup_recipients():
    key_a = {"address": "qor1a", "algorithm_id": 2, "algorithm_name": "ml-kem-1024",
             "public_key": "0a0b", "registered_height": "9"}
    node = _Node(
        {"rollup_id": "p1", "privacy": "encapsulated", "members": ["qor1a", "qor1b"],
         "members_epoch": "3"},
        kem_keys={"qor1a": key_a, "qor1b": dict(key_a, address="qor1b", public_key="0c0d")},
    )
    rest = RestClient("http://node", node)
    k = rest.get_kem_key("qor1a")
    assert (k.algorithm_id, k.public_key, k.registered_height) == (2, "0a0b", 9)
    assert rest.get_kem_key("qor1nobody") is None
    assert "http://node/qorechain/pqc/v1/kem/qor1a" in node.urls
    epoch, recipients = rest.get_private_rollup_recipients("p1")
    assert epoch == 3
    assert recipients == [("qor1a", "0a0b"), ("qor1b", "0c0d")]

    node.kem_keys["qor1b"] = dict(key_a, address="qor1b", algorithm_id=1)
    with pytest.raises(ValueError, match="qor1b has no ML-KEM-1024 key"):
        rest.get_private_rollup_recipients("p1")
    del node.kem_keys["qor1b"]
    with pytest.raises(ValueError, match="qor1b has no ML-KEM-1024 key"):
        rest.get_private_rollup_recipients("p1")
    node.rollup["privacy"] = ""
    with pytest.raises(ValueError, match="not private"):
        rest.get_private_rollup_recipients("p1")
    node.rollup.update(privacy="encapsulated", members=[])
    with pytest.raises(ValueError, match="no members"):
        rest.get_private_rollup_recipients("p1")
