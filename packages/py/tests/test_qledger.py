"""qledger-v1 against the vectors in ``v328.json`` (key ``qledger``), which come
from the chain's own qledger package: keys, transactions, roots after every
entry, withdrawals, witnesses, the fraud proof, and the batch admission rules."""

from __future__ import annotations

import base64
import json
from urllib.parse import unquote

import pytest

from qorrdk import (
    BLS12_381_SCALAR_MODULUS,
    DEFAULT_POSTED_DATA_RETENTION_BLOCKS,
    MAX_POSTED_DATA_RETENTION_BLOCKS,
    MIN_POSTED_DATA_RETENTION_BLOCKS,
    QLEDGER_CHECKPOINT_INTERVAL,
    QLEDGER_DEPOSIT_POSTER_PREFIX,
    QLEDGER_FRESH_POST_BLOCKS,
    QLEDGER_MAX_BATCH_ENTRIES,
    QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER,
    QLEDGER_SLASH_BURN_PERCENT,
    QLEDGER_WITHDRAWAL_COUNTER_ID,
    HttpResponse,
    QledgerClaim,
    QledgerEntry,
    QledgerIncompleteWitnessError,
    QledgerLedger,
    QledgerPartialTree,
    QledgerWithdrawal,
    RdkTxClient,
    RestClient,
    build_qledger_fraud_proof,
    check_qledger_fraud,
    choose_qledger_batch_end,
    decode_qledger_deposit,
    decode_qledger_fraud_proof,
    decode_qledger_tx,
    encode_qledger_deposit,
    encode_qledger_fraud_proof,
    encode_qledger_tx,
    execute_qledger,
    fetch_qledger_entries,
    inbox_range_hash,
    is_canonical_qor_address,
    is_qledger_checkpoint,
    plan_qledger_batch,
    posted_data_hash,
    qledger_accumulate,
    qledger_batch_errors,
    qledger_empty_root,
    qledger_keypair_from_seed,
    qledger_signing_message,
    qledger_tx_unsigned,
    qledger_withdrawal_proof,
    qledger_withdrawals_root,
    sign_qledger_tx,
    to_canonical_scalar,
    verify_qledger_tx,
    withdrawals_root_matches,
    zk_public_input_errors,
    zk_public_inputs,
)


@pytest.fixture(scope="module")
def q(v328) -> dict:
    return v328["qledger"]


@pytest.fixture(scope="module")
def env(q) -> dict:
    return {"chain_id": q["chainId"], "rollup_id": q["rollupId"]}


@pytest.fixture(scope="module")
def entries(q) -> list:
    return [
        QledgerEntry(height=e["height"], poster=e["poster"], payload=bytes.fromhex(e["payload"]))
        for e in q["entries"]
    ]


# --------------------------------------------------------------------------- #
# Execution model.
# --------------------------------------------------------------------------- #


def test_empty_root_counter_slot_and_account_keys(q):
    assert qledger_empty_root().hex() == q["emptyRoot"]
    assert QLEDGER_WITHDRAWAL_COUNTER_ID.hex() == q["withdrawalCounterId"]
    for a in q["accounts"]:
        kp = qledger_keypair_from_seed(a["seed"])
        assert kp.public_key.hex() == a["publicKey"]
        assert kp.account_id.hex() == a["id"]
    with pytest.raises(ValueError, match="32 bytes"):
        qledger_keypair_from_seed("01" * 31)


def test_signs_transactions_byte_for_byte(q, env):
    a = qledger_keypair_from_seed(q["accounts"][0]["seed"])
    keys = {"secret_key": a.secret_key, "public_key": a.public_key}
    t1 = sign_qledger_tx(**env, **keys, nonce=0, to=q["accounts"][1]["id"], amount=1_000_000)
    assert qledger_tx_unsigned(t1).hex() == q["txs"]["t1"]["unsigned"]
    assert (
        qledger_signing_message(q["chainId"], q["rollupId"], qledger_tx_unsigned(t1)).hex()
        == q["txs"]["t1"]["signingMessage"]
    )
    assert encode_qledger_tx(t1).hex() == q["txs"]["t1"]["encoded"]
    t2 = sign_qledger_tx(**env, **keys, nonce=1, recipient=q["recipient"], amount=700_000)
    assert qledger_tx_unsigned(t2).hex() == q["txs"]["t2"]["unsigned"]
    assert encode_qledger_tx(t2).hex() == q["txs"]["t2"]["encoded"]
    parsed = decode_qledger_tx(q["txs"]["t2"]["encoded"])
    assert parsed is not None and parsed.recipient == q["recipient"]
    assert verify_qledger_tx(parsed, q["chainId"], q["rollupId"]) is True
    assert verify_qledger_tx(parsed, q["chainId"], "other-rollup") is False
    assert decode_qledger_tx(q["txs"]["t1"]["encoded"] + "00") is None
    with pytest.raises(ValueError, match="exactly one"):
        sign_qledger_tx(**env, **keys, nonce=0, amount=1)
    with pytest.raises(ValueError, match="1 to 90 bytes, got 91"):
        sign_qledger_tx(**env, **keys, nonce=0, amount=1, recipient="q" * 91)
    with pytest.raises(ValueError, match="got 0"):
        sign_qledger_tx(**env, **keys, nonce=0, amount=1, recipient="")


def test_executes_every_entry_to_the_chains_root(q, env, entries):
    led = QledgerLedger()
    for e, want in zip(entries, q["entries"]):
        execute_qledger(led, [e], **env)
        assert led.root().hex() == want["rootAfter"], want["note"]


def test_batch_roots_withdrawals_and_proofs(q, env, entries):
    res = execute_qledger(QledgerLedger(), entries, **env)
    assert res.state_root.hex() == q["batch"]["stateRoot"]
    assert res.withdrawals_root.hex() == q["batch"]["withdrawalsRoot"]
    assert [(w.index, w.recipient, w.amount) for w in res.withdrawals] == [
        (w["index"], w["recipient"], w["amount"]) for w in q["batch"]["withdrawals"]
    ]
    for i in range(len(res.withdrawals)):
        proof = qledger_withdrawal_proof(q["chainId"], q["rollupId"], res.withdrawals, i)
        assert [p.hex() for p in proof] == q["batch"]["proofs"][i]
    later = [QledgerWithdrawal(index=i, recipient=q["recipient"], amount=k + 1)
             for k, i in enumerate([5, 6, 7])]
    assert qledger_withdrawals_root(q["chainId"], q["rollupId"], later).hex() == (
        q["laterWithdrawals"]["root"]
    )
    assert [p.hex() for p in qledger_withdrawal_proof(q["chainId"], q["rollupId"], later, 2)] == (
        q["laterWithdrawals"]["proofOfIndex7"]
    )
    assert qledger_withdrawals_root(q["chainId"], q["rollupId"], []) == b""
    with pytest.raises(ValueError, match="no such withdrawal"):
        qledger_withdrawal_proof(q["chainId"], q["rollupId"], later, 3)


def test_witnesses_and_partial_tree_update(q, env, entries):
    led = QledgerLedger()
    execute_qledger(led, entries, **env)
    w_after = q["witnessesAfterBatch"]
    assert led.root().hex() == w_after["root"]
    for w in w_after["witnesses"]:
        got = led.witness(w["id"])
        assert {
            "id": got.id.hex(),
            "balance": got.balance,
            "nonce": got.nonce,
            "bitmap": got.bitmap.hex(),
            "siblings": [s.hex() for s in got.siblings],
        } == {**w, "siblings": w.get("siblings") or []}
    ws = [led.witness(w["id"]) for w in w_after["witnesses"]]
    tree = QledgerPartialTree(led.root(), ws)
    account = bytes.fromhex(w_after["witnesses"][3]["id"])
    tree.set(account, 1, 0)
    led.set(account, 1, 0)
    assert tree.root() == led.root()
    with pytest.raises(QledgerIncompleteWitnessError, match="does not open"):
        tree.get(bytes([9]) * 32)
    with pytest.raises(ValueError, match="does not match"):
        QledgerPartialTree(bytes(32), ws)


def test_fraud_proof_byte_for_byte_and_both_verdicts(q, env, entries):
    parent = QledgerLedger()
    execute_qledger(parent, entries[:2], **env)
    f = q["fraud"]
    assert parent.root().hex() == f["parentRoot"]
    proof, honest = build_qledger_fraud_proof(parent, q["batch"]["accFrom"], entries[2:], **env)
    assert proof.hex() == f["proof"]
    assert honest.state_root.hex() == f["honestStateRoot"]
    assert encode_qledger_fraud_proof(decode_qledger_fraud_proof(proof)).hex() == f["proof"]
    claim = dict(
        inbox_start=f["inboxStart"],
        inbox_end=f["inboxEnd"],
        data_hash=f["dataHash"],
        prev_state_root=f["parentRoot"],
        state_root=f["honestStateRoot"],
        withdrawals_root=f["honestWithdrawalsRoot"],
    )
    assert check_qledger_fraud(QledgerClaim(**claim), proof, **env) is False
    wrong = QledgerClaim(**{**claim, "state_root": f["wrongStateRoot"]})
    assert check_qledger_fraud(wrong, proof, **env) is True
    with pytest.raises(ValueError, match="does not apply"):
        check_qledger_fraud(QledgerClaim(**{**claim, "inbox_end": f["inboxEnd"] + 1}), proof, **env)
    with pytest.raises(ValueError, match="does not apply"):
        check_qledger_fraud(QledgerClaim(**{**claim, "data_hash": "00" * 32}), proof, **env)
    with pytest.raises(ValueError, match="malformed"):
        decode_qledger_fraud_proof(proof + b"\x00")


def test_canonical_recipients_and_deposit_payloads(q, entries):
    assert is_canonical_qor_address(q["recipient"]) is True
    assert is_canonical_qor_address(q["recipient"].upper()) is False
    assert is_canonical_qor_address("cosmos1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnuddlrw") is False
    dep = entries[0]
    assert dep.poster.startswith(QLEDGER_DEPOSIT_POSTER_PREFIX)
    assert encode_qledger_deposit(q["accounts"][0]["id"], 5_000_000) == dep.payload
    parsed = decode_qledger_deposit(dep.payload)
    assert parsed is not None and parsed.amount == 5_000_000
    assert decode_qledger_deposit(dep.payload[:-1]) is None


# --------------------------------------------------------------------------- #
# Admission rules.
# --------------------------------------------------------------------------- #

_BASE = {"bond": 2_000_000_000, "min_bond": 1_000_000_000, "pending": 0, "end_retained": True}


def test_constants():
    assert (QLEDGER_FRESH_POST_BLOCKS, QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER,
            QLEDGER_CHECKPOINT_INTERVAL, QLEDGER_SLASH_BURN_PERCENT,
            QLEDGER_MAX_BATCH_ENTRIES) == (20, 1024, 64, 50, 64)
    assert (DEFAULT_POSTED_DATA_RETENTION_BLOCKS, MIN_POSTED_DATA_RETENTION_BLOCKS,
            MAX_POSTED_DATA_RETENTION_BLOCKS) == (648_000, 100, 25_920_000)


def test_checkpoints_are_non_zero_multiples_of_64():
    assert [is_qledger_checkpoint(x) for x in (0, 1, 63, 64, 128)] == [
        False, False, False, True, True,
    ]


def test_bond_pending_cap_range_and_size():
    def errs(**kw):
        return "; ".join(qledger_batch_errors(**{**_BASE, **kw}))

    assert qledger_batch_errors(**_BASE, consumed=0, head=10, end=10) == []
    assert "bond" in errs(bond=1, consumed=0, head=10, end=10)
    assert "waiting" in errs(pending=1024, consumed=0, head=10, end=10)
    assert "at least one" in errs(consumed=5, head=10, end=5)
    assert "past the head" in errs(consumed=0, head=10, end=11)
    assert "at most 64" in errs(consumed=0, head=100, end=65)
    assert qledger_batch_errors(**_BASE, consumed=0, head=100, end=64) == []


def test_short_batch_stops_before_a_fresh_post_or_at_an_unretained_checkpoint():
    short = {**_BASE, "consumed": 0, "head": 100, "end": 10}
    assert qledger_batch_errors(
        **short, next_retained=True, next_height=990, inclusion_height=1000
    ) == []
    assert "post 11 must be in it" in "; ".join(
        qledger_batch_errors(**short, next_retained=True, next_height=980, inclusion_height=1000)
    )
    assert "post 11" in "; ".join(qledger_batch_errors(**short, next_retained=False))
    assert qledger_batch_errors(
        **{**_BASE, "consumed": 40, "head": 300, "end": 64}, next_retained=False
    ) == []
    assert "no longer retained" in "; ".join(qledger_batch_errors(
        **{**_BASE, "end_retained": False}, consumed=0, head=300, end=20, next_retained=False,
    ))


def test_chooses_the_end_the_chain_recommends():
    def every(_x):
        return True

    def only_checkpoints(x):
        return x % 64 == 0

    assert choose_qledger_batch_end(consumed=5, head=5, retained=every) is None
    assert choose_qledger_batch_end(consumed=0, head=10, retained=every) == 10
    assert choose_qledger_batch_end(consumed=0, head=200, retained=every) == 64
    # After a long idle period only checkpoints kept their commitments.
    assert choose_qledger_batch_end(consumed=40, head=500, retained=only_checkpoints) == 64
    assert choose_qledger_batch_end(consumed=64, head=500, retained=only_checkpoints) == 128


# --------------------------------------------------------------------------- #
# Groth16 withdrawals root modulo r.
# --------------------------------------------------------------------------- #

_R = BLS12_381_SCALAR_MODULUS
_HIGH = format(_R + 5, "064x")
_LOW = "05".rjust(64, "0")


def test_any_withdrawals_root_passes_and_the_circuit_takes_it_mod_r():
    assert zk_public_input_errors(state_root=_LOW, withdrawals_root=_HIGH) == []
    assert "state_root" in "; ".join(zk_public_input_errors(state_root=_HIGH))
    ins = zk_public_inputs(prev_state_root=_LOW, state_root=_LOW, withdrawals_root=_HIGH)
    assert [x.hex() for x in ins] == [_LOW, _LOW, "00" * 32, to_canonical_scalar(_HIGH).hex()]
    assert ins[3].hex() == _LOW


def test_compares_mod_r_only_when_the_chain_reduced_the_stored_root():
    assert withdrawals_root_matches(_LOW, _HIGH, True) is True
    assert withdrawals_root_matches(_LOW, _HIGH, False) is False
    assert withdrawals_root_matches(_HIGH, _HIGH, False) is True


# --------------------------------------------------------------------------- #
# Planning from a node.
# --------------------------------------------------------------------------- #


class _FakeNode:
    """A node serving a qledger-v1 rollup whose inbox holds the fixture's entries."""

    def __init__(self, q, entries):
        self.chain_id = q["chainId"]
        self.rollup_id = rid = q["rollupId"]
        self.accs = []
        acc = b""
        for i, e in enumerate(entries):
            acc = qledger_accumulate(chain_id=self.chain_id, rollup_id=rid, from_sequence=i,
                                     acc_from=acc, entries=[e])
            self.accs.append(acc)
        self.head = len(entries)
        self.posts, self.deposits = [], []
        for i, e in enumerate(entries):
            seq = str(i + 1)
            if e.poster.startswith("deposit:"):
                d = decode_qledger_deposit(e.payload)
                self.deposits.append({
                    "height": str(e.height), "txhash": f"D{seq}",
                    "events": [{"type": "rdk_rollup_deposit", "attributes": [
                        {"key": "rollup_id", "value": rid},
                        {"key": "depositor", "value": e.poster[len("deposit:"):]},
                        {"key": "account", "value": d.account.hex()},
                        {"key": "amount", "value": f"{d.amount}uqor"},
                        {"key": "sequence", "value": seq},
                    ]}],
                })
            else:
                self.posts.append({
                    "height": str(e.height), "txhash": f"P{seq}",
                    "tx": {"body": {"messages": [{
                        "@type": "/qorechain.rdk.v1.MsgPostRollupData", "poster": e.poster,
                        "rollup_id": rid, "data": base64.b64encode(e.payload).decode(),
                    }]}},
                    "events": [{"type": "rdk_data_posted", "attributes": [
                        {"key": "rollup_id", "value": rid},
                        {"key": "sequence", "value": seq},
                        {"key": "data_hash", "value": posted_data_hash(e.payload).hex()},
                        {"key": "poster", "value": e.poster},
                    ]}],
                })
        inbox = {"head_sequence": str(self.head), "consumed_sequence": "0",
                 "consumed_acc": "00" * 32, "range_end": str(self.head),
                 "range_data_hash": self.range(self.head)}
        self.routes = {
            f"/qorechain/rdk/v1/rollup/{rid}": {"rollup": {
                "rollup_id": rid, "execution_vm": "qledger-v1", "sequencing": "based",
                "settlement_mode": "optimistic"}},
            "/qorechain/rdk/v1/params": {"params": {"min_submitter_bond": "1000000000"}},
            f"/qorechain/rdk/v1/submitter_bond/{rid}/qor1sub": {
                "amount": "1000000000", "pending": "0"},
            f"/qorechain/rdk/v1/inbox/{rid}": {"inbox": inbox},
            f"/qorechain/rdk/v1/inbox/{rid}?inbox_end={self.head}": {"inbox": inbox},
            "/cosmos/base/node/v1beta1/status": {"height": "1000"},
        }
        self.posted = False

    def range(self, end):
        return inbox_range_hash(chain_id=self.chain_id, rollup_id=self.rollup_id,
                                from_sequence=0, to_sequence=end, acc_from=b"",
                                acc_to=self.accs[end - 1]).hex()

    def __call__(self, method, url, headers=None, body=None):
        path = url.replace("http://node", "")
        if path.startswith("/cosmos/tx/v1beta1/txs?query="):
            query = unquote(path.split("query=")[1].split("&")[0])
            txs = self.posts if query.startswith("rdk_data_posted") else self.deposits
            return HttpResponse(200, "OK", json.dumps(
                {"tx_responses": txs, "total": str(len(txs))}))
        if path in self.routes:
            return HttpResponse(200, "OK", json.dumps(self.routes[path]))
        if path.startswith("/cosmos/auth/v1beta1/accounts/"):
            return HttpResponse(200, "OK", json.dumps(
                {"account": {"account_number": "1", "sequence": "0"}}))
        if method == "POST" and path == "/cosmos/tx/v1beta1/txs":
            self.posted = True
            return HttpResponse(200, "OK", json.dumps(
                {"tx_response": {"txhash": "H", "code": 0, "raw_log": ""}}))
        return HttpResponse(404, "Not Found", "{}")


def test_plans_the_first_batch_from_the_chain_and_reproduces_its_roots(q, entries):
    node = _FakeNode(q, entries)
    rest = RestClient("http://node", node)
    args = {"chain_id": node.chain_id, "rollup_id": node.rollup_id, "submitter": "qor1sub"}
    plan = plan_qledger_batch(rest, **args, ledger=QledgerLedger())
    assert plan.input["inbox_end"] == node.head
    assert plan.input["batch_index"] == 0
    assert plan.input["prev_state_root"] == qledger_empty_root()
    assert plan.input["state_root"].hex() == q["batch"]["stateRoot"]
    assert plan.input["withdrawals_root"].hex() == q["batch"]["withdrawalsRoot"]
    assert plan.input["data_hash"].hex() == node.range(node.head)
    assert plan.input["tx_count"] == len(entries)
    assert len(plan.result.withdrawals) == 2
    assert plan.ledger.root().hex() == q["batch"]["stateRoot"]

    node.routes[f"/qorechain/rdk/v1/submitter_bond/{node.rollup_id}/qor1sub"] = {
        "amount": "5", "pending": "0"}
    with pytest.raises(ValueError, match="bond"):
        plan_qledger_batch(rest, **args, ledger=QledgerLedger())


def test_only_a_404_means_no_batch_yet_or_not_retained(q, entries):
    node = _FakeNode(q, entries)
    rest = RestClient("http://node", node)
    args = {"chain_id": node.chain_id, "rollup_id": node.rollup_id, "submitter": "qor1sub"}
    failing = {"latest_batch": 0}

    def flaky(method, url, headers=None, body=None):
        if "/latest_batch/" in url and failing["latest_batch"]:
            return HttpResponse(failing["latest_batch"], "Error", "{}")
        return node(method, url, headers, body)

    flaky_rest = RestClient("http://node", flaky)
    failing["latest_batch"] = 503
    with pytest.raises(RuntimeError, match="503"):
        plan_qledger_batch(flaky_rest, **args, ledger=QledgerLedger())
    failing["latest_batch"] = 404
    assert plan_qledger_batch(flaky_rest, **args, ledger=QledgerLedger()).input["batch_index"] == 0

    # A short batch: the head is past 64, so the next post's commitment is read.
    from qorrdk.qledger.batch import _next_post

    def posted(status):
        def transport(method, url, headers=None, body=None):
            if "/posted_data/" in url:
                if status == 200:
                    return HttpResponse(200, "OK", json.dumps({"posted_data": {"height": "990"}}))
                return HttpResponse(status, "Error", "{}")
            return node(method, url, headers, body)
        return RestClient("http://node", transport)

    assert _next_post(posted(200), node.rollup_id, 5, 10) == (True, 990)
    assert _next_post(posted(404), node.rollup_id, 5, 10) == (False, None)
    with pytest.raises(RuntimeError, match="500"):
        _next_post(posted(500), node.rollup_id, 5, 10)
    assert _next_post(rest, node.rollup_id, 10, 10) == (None, None)


def test_fetch_refuses_entries_that_do_not_match_the_accumulator(q, entries):
    node = _FakeNode(q, entries)
    rest = RestClient("http://node", node)
    args = {"chain_id": node.chain_id, "rollup_id": node.rollup_id,
            "from_sequence": 0, "to_sequence": node.head, "acc_from": ""}
    assert [e.payload for e in fetch_qledger_entries(rest, **args)] == [
        e.payload for e in entries
    ]
    node.posts[0]["height"] = str(int(node.posts[0]["height"]) + 1)
    with pytest.raises(ValueError, match="do not match"):
        fetch_qledger_entries(rest, **args)
    node.posts.pop(0)
    with pytest.raises(ValueError, match="not found"):
        fetch_qledger_entries(rest, **args)


def test_submit_batch_checks_the_qledger_admission_rules(q, entries, golden):
    from qorrdk import signer_from_private_key

    node = _FakeNode(q, entries)
    signer = signer_from_private_key(golden["privateKeyHex"])
    node.routes[f"/qorechain/rdk/v1/submitter_bond/{node.rollup_id}/{signer.address}"] = {
        "amount": "5", "pending": "0"}
    tx = RdkTxClient(rest_url="http://node", chain_id="qorechain-diana", signer=signer,
                     transport=node)
    batch = {"rollup_id": node.rollup_id, "batch_index": 0, "state_root": "11" * 32,
             "prev_state_root": qledger_empty_root(), "tx_count": node.head,
             "data_hash": node.range(node.head), "inbox_end": node.head}
    with pytest.raises(ValueError, match="bond"):
        tx.submit_batch(dict(batch))
    assert node.posted is False
    node.routes[f"/qorechain/rdk/v1/submitter_bond/{node.rollup_id}/{signer.address}"] = {
        "amount": "1000000000", "pending": "1024"}
    with pytest.raises(ValueError, match="waiting for finality"):
        tx.submit_batch(dict(batch))
    node.routes[f"/qorechain/rdk/v1/submitter_bond/{node.rollup_id}/{signer.address}"] = {
        "amount": "1000000000", "pending": "0"}
    assert tx.submit_batch(dict(batch)).code == 0
    assert node.posted


def test_rest_latest_height_and_tx_search():
    seen = []

    def transport(method, url, headers=None, body=None):
        seen.append(url)
        if url.endswith("/cosmos/base/node/v1beta1/status"):
            return HttpResponse(200, "OK", json.dumps({"height": "77"}))
        if "/cosmos/tx/v1beta1/txs?" in url:
            page = int(url.split("page=")[1].split("&")[0])
            txs = [{"txhash": f"T{page}{i}"} for i in range(2 if page == 1 else 1)]
            return HttpResponse(200, "OK", json.dumps({"tx_responses": txs, "total": "3"}))
        return HttpResponse(404, "Not Found", "{}")

    rest = RestClient("http://node", transport)
    assert rest.get_latest_height() == 77
    txs = rest.search_txs("rdk_data_posted.rollup_id='r1'", page_limit=2)
    assert [t["txhash"] for t in txs] == ["T10", "T11", "T20"]
    assert seen[1] == (
        "http://node/cosmos/tx/v1beta1/txs?query=rdk_data_posted.rollup_id%3D%27r1%27"
        "&page=1&limit=2&order_by=ORDER_BY_ASC"
    )
