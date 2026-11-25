"""Watching a qledger-v1 rollup: the watchtower judges a batch the way the chain
decides a challenge against it, by re-executing the inbox entries it consumed.

The fixture's qledger batch (``v328.json``, key ``qledger``) consumes 11 inbox
entries (sequences 4 to 14) from the empty ledger, with the roots the chain
accepted."""

from __future__ import annotations

import base64
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from urllib.parse import parse_qs, urlparse

import pytest

from qorrdk import (
    QLEDGER_DEPOSIT_POSTER_PREFIX,
    HttpResponse,
    QledgerClaim,
    QledgerEntry,
    QledgerJudge,
    QledgerJudgement,
    QledgerLedger,
    batch_transition_root,
    check_qledger_fraud,
    create_rdk_client,
    decode_qledger_deposit,
    decode_wire_bytes,
    execute_qledger,
    inbox_range_hash,
    posted_data_hash,
    qledger_accumulate,
    qledger_fraud_proof_for_batch,
    qledger_validator,
    transition_root_version_for_batch,
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


@pytest.fixture(scope="module")
def start(q) -> int:
    return q["batch"]["inboxStart"]


@pytest.fixture(scope="module")
def end(q) -> int:
    return q["batch"]["inboxEnd"]


@pytest.fixture(scope="module")
def honest(q, entries) -> dict:
    b = q["batch"]
    return {
        "batch_index": 0,
        "status": "submitted",
        "prev_state_root": q["emptyRoot"],
        "state_root": b["stateRoot"],
        "withdrawals_root": b["withdrawalsRoot"],
        "data_hash": b["dataHash"],
        "tx_count": len(entries),
        "inbox_start": b["inboxStart"],
        "inbox_end": b["inboxEnd"],
        "submitted_at": 100,
        "withdrawals_bound": True,
    }


@pytest.fixture(scope="module")
def accs_one_batch(q, start) -> dict:
    return {start: q["batch"]["accFrom"]}


def _ok(body) -> HttpResponse:
    return HttpResponse(200, "OK", json.dumps(body))


class _Node:
    """A node serving one qledger-v1 rollup: its batches, the inbox accumulator
    after each post, and (optionally) the transaction index and inbox ranges
    the default entry reader reads."""

    def __init__(self, rollup_id, batches, accs, *, txs=None, inbox=None):
        self.rollup_id = rollup_id
        self.batches = batches
        self.accs = accs
        self.txs = txs or {}
        self.inbox = inbox or {}
        self.calls: list[str] = []

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append(url)
        u = urlparse(url)
        path = u.path
        if "/qorechain/rdk/v1/batches/" in path:
            return _ok({"batches": self.batches, "next_index": 0})
        posted = re.search(r"/qorechain/rdk/v1/posted_data/[^/]+/(\d+)$", path)
        if posted:
            acc = self.accs.get(int(posted.group(1)))
            if acc is None:
                return HttpResponse(404, "Not Found", json.dumps({"code": 5, "message": "not found"}))
            return _ok({"posted_data": {"sequence": posted.group(1), "inbox_acc": acc}})
        if "/cosmos/upgrade/v1beta1/applied_plan/" in path:
            return _ok({"height": "1"})
        if path == "/cosmos/tx/v1beta1/txs":
            query = parse_qs(u.query)["query"][0]
            txs = self.txs.get(query.split(".", 1)[0], [])
            return _ok({"tx_responses": txs, "total": str(len(txs))})
        if path.startswith("/qorechain/rdk/v1/inbox/"):
            inbox_end = int(parse_qs(u.query).get("inbox_end", ["0"])[0])
            if inbox_end in self.inbox:
                return _ok({"inbox": self.inbox[inbox_end]})
            return HttpResponse(404, "Not Found", "{}")
        return _ok({})


def _client(q, batches, accs, **kw):
    node = _Node(q["rollupId"], batches, accs, **kw)
    client = create_rdk_client(transport=node)
    assert client.network.chain_id == q["chainId"]
    return client, node


def _batch(client, rollup_id, index=0):
    for b in client.rest.list_batches(rollup_id):
        if b.batch_index == index:
            return b
    raise AssertionError(f"no batch {index}")


def _reader(entries, start, ranges=None):
    """Entries ``from_sequence + 1`` to ``to_sequence``, as a node's transaction
    index would return them."""

    def read(*, from_sequence, to_sequence, acc_from):
        if ranges is not None:
            ranges.append((from_sequence, to_sequence))
        return entries[from_sequence - start : to_sequence - start]

    return read


# --------------------------------------------------------------------------- #
# One batch.
# --------------------------------------------------------------------------- #


def test_the_transition_root_rule_reports_the_honest_batch_invalid(q, env, honest, accs_one_batch):
    """Why the qledger validator exists: a qledger-v1 state root is the root of
    the account tree, never the canonical transition root."""
    client, _ = _client(q, [honest], accs_one_batch)
    b = _batch(client, env["rollup_id"])
    canonical = batch_transition_root(
        transition_root_version_for_batch(client.rest, b),
        decode_wire_bytes(b.prev_state_root),
        b.tx_count,
        decode_wire_bytes(b.data_hash),
        chain_id=env["chain_id"],
        rollup_id=env["rollup_id"],
        withdrawals_root=decode_wire_bytes(b.withdrawals_root),
    )
    assert canonical != decode_wire_bytes(b.state_root)


def test_an_honest_batch_is_valid_and_has_no_proof(q, env, entries, start, honest, accs_one_batch):
    client, _ = _client(q, [honest], accs_one_batch)
    b = _batch(client, env["rollup_id"])
    read = _reader(entries, start)
    assert qledger_validator(client, env["rollup_id"], read_entries=read)(b) is True
    assert qledger_fraud_proof_for_batch(client, env["rollup_id"], b, read_entries=read) is None
    judgement = QledgerJudge(client, env["rollup_id"], read_entries=read).judge(b)
    assert isinstance(judgement, QledgerJudgement)
    assert judgement.valid is True and judgement.proof is None
    assert judgement.honest_state_root.hex() == q["batch"]["stateRoot"]
    assert judgement.honest_withdrawals_root.hex() == q["batch"]["withdrawalsRoot"]


def test_a_wrong_state_root_is_invalid_with_a_proof_the_chains_check_upholds(
    q, env, entries, start, end, honest, accs_one_batch
):
    wrong = {**honest, "state_root": "ab" * 32}
    client, _ = _client(q, [wrong], accs_one_batch)
    b = _batch(client, env["rollup_id"])
    read = _reader(entries, start)
    assert qledger_validator(client, env["rollup_id"], read_entries=read)(b) is False
    proof = qledger_fraud_proof_for_batch(client, env["rollup_id"], b, read_entries=read)
    assert isinstance(proof, bytes)
    claim = QledgerClaim(
        inbox_start=start,
        inbox_end=end,
        data_hash=wrong["data_hash"],
        prev_state_root=wrong["prev_state_root"],
        state_root=wrong["state_root"],
        withdrawals_root=wrong["withdrawals_root"],
    )
    assert check_qledger_fraud(claim, proof, **env) is True
    # The same proof does not win against the honest roots.
    assert check_qledger_fraud(replace(claim, state_root=honest["state_root"]), proof, **env) is False
    judgement = QledgerJudge(client, env["rollup_id"], read_entries=read).judge(b)
    assert judgement.valid is False
    assert judgement.proof == proof
    assert judgement.honest_state_root.hex() == q["batch"]["stateRoot"]


def test_a_wrong_withdrawals_root_is_invalid(q, env, entries, start, honest, accs_one_batch):
    wrong = {**honest, "withdrawals_root": "cd" * 32}
    client, _ = _client(q, [wrong], accs_one_batch)
    b = _batch(client, env["rollup_id"])
    read = _reader(entries, start)
    assert qledger_validator(client, env["rollup_id"], read_entries=read)(b) is False
    proof = qledger_fraud_proof_for_batch(client, env["rollup_id"], b, read_entries=read)
    assert proof is not None


def test_entries_that_do_not_belong_to_the_batch_leave_it_undecided(
    q, env, entries, honest, accs_one_batch
):
    client, _ = _client(q, [honest], accs_one_batch)
    b = _batch(client, env["rollup_id"])
    short = qledger_validator(client, env["rollup_id"], read_entries=lambda **_: entries[:-1])
    with pytest.raises(ValueError, match="does not apply"):
        short(b)
    swapped = [entries[1], entries[0], *entries[2:]]
    reordered = qledger_validator(client, env["rollup_id"], read_entries=lambda **_: swapped)
    with pytest.raises(ValueError, match="does not apply"):
        reordered(b)
    with pytest.raises(ValueError, match="does not apply"):
        qledger_fraud_proof_for_batch(
            client, env["rollup_id"], b, read_entries=lambda **_: entries[:-1]
        )


def test_an_injected_entry_reader_is_used_instead_of_the_node(
    q, env, entries, start, end, honest, accs_one_batch
):
    client, node = _client(q, [honest], accs_one_batch)
    b = _batch(client, env["rollup_id"])
    seen = []

    def read(*, from_sequence, to_sequence, acc_from):
        seen.append((from_sequence, to_sequence, acc_from))
        return entries

    assert qledger_validator(client, env["rollup_id"], read_entries=read)(b) is True
    assert seen == [(start, end, bytes.fromhex(q["batch"]["accFrom"]))]
    assert not any("/cosmos/tx/v1beta1/txs" in u or "/rdk/v1/inbox/" in u for u in node.calls)


def test_the_default_reader_fetches_and_checks_entries_from_the_node(
    q, env, entries, start, end, honest, accs_one_batch
):
    rid = env["rollup_id"]
    posts, deposits = [], []
    for i, e in enumerate(entries):
        seq = str(start + i + 1)
        if e.poster.startswith(QLEDGER_DEPOSIT_POSTER_PREFIX):
            d = decode_qledger_deposit(e.payload)
            deposits.append({
                "height": str(e.height), "txhash": f"D{seq}",
                "events": [{"type": "rdk_rollup_deposit", "attributes": [
                    {"key": "rollup_id", "value": rid},
                    {"key": "depositor", "value": e.poster[len(QLEDGER_DEPOSIT_POSTER_PREFIX):]},
                    {"key": "account", "value": d.account.hex()},
                    {"key": "amount", "value": f"{d.amount}uqor"},
                    {"key": "sequence", "value": seq},
                ]}],
            })
        else:
            posts.append({
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
    inbox = {
        "rollup_id": rid, "sequencing": "based", "head_sequence": str(end),
        "consumed_sequence": str(start), "range_end": str(end),
        "range_data_hash": q["batch"]["dataHash"],
    }
    client, node = _client(
        q, [honest], accs_one_batch,
        txs={"rdk_data_posted": posts, "rdk_rollup_deposit": deposits}, inbox={end: inbox},
    )
    b = _batch(client, rid)
    assert qledger_validator(client, rid)(b) is True
    assert any("/cosmos/tx/v1beta1/txs" in u for u in node.calls)
    wrong = {**honest, "state_root": "ab" * 32}
    node.batches = [wrong]
    assert qledger_validator(client, rid)(_batch(client, rid)) is False
    # A node whose transaction index disagrees with the chain's commitment.
    posts[0]["height"] = str(int(posts[0]["height"]) + 1)
    with pytest.raises(ValueError, match="do not match"):
        qledger_validator(client, rid)(b)


# --------------------------------------------------------------------------- #
# Across batches: the fixture's entries split in two batches, settled in turn.
# --------------------------------------------------------------------------- #

_CUT = 5


@pytest.fixture(scope="module")
def split(q, env, entries, start, end, honest) -> dict:
    first, second = entries[:_CUT], entries[_CUT:]
    mid = start + _CUT
    ledger = QledgerLedger()
    r1 = execute_qledger(ledger, first, **env)
    r2 = execute_qledger(ledger, second, **env)
    acc_from = q["batch"]["accFrom"]
    acc_mid = qledger_accumulate(**env, from_sequence=start, acc_from=acc_from, entries=first)
    acc_end = qledger_accumulate(**env, from_sequence=mid, acc_from=acc_mid, entries=second)

    def data_hash(lo, hi, a, b):
        return inbox_range_hash(**env, from_sequence=lo, to_sequence=hi, acc_from=a, acc_to=b).hex()

    b0 = {
        **honest,
        "state_root": r1.state_root.hex(),
        "withdrawals_root": r1.withdrawals_root.hex(),
        "data_hash": data_hash(start, mid, acc_from, acc_mid),
        "tx_count": len(first),
        "inbox_end": mid,
    }
    b1 = {
        **honest,
        "batch_index": 1,
        "prev_state_root": r1.state_root.hex(),
        "state_root": r2.state_root.hex(),
        "withdrawals_root": r2.withdrawals_root.hex(),
        "data_hash": data_hash(mid, end, acc_mid, acc_end),
        "tx_count": len(second),
        "inbox_start": mid,
        "submitted_at": 101,
    }
    return {"b0": b0, "b1": b1, "mid": mid, "accs": {start: acc_from, mid: acc_mid.hex()}}


def test_rebuilds_the_parent_state_by_replay_and_caches_it(q, env, entries, start, end, split):
    client, _ = _client(q, [split["b0"], split["b1"]], split["accs"])
    ranges: list = []
    validate = qledger_validator(client, env["rollup_id"], read_entries=_reader(entries, start, ranges))
    b1 = _batch(client, env["rollup_id"], 1)
    assert validate(b1) is True
    assert ranges == [(start, split["mid"]), (split["mid"], end)]
    # The state after batch 0 is now known, so judging batch 1 again reads only its own entries.
    ranges.clear()
    assert validate(b1) is True
    assert ranges == [(split["mid"], end)]


def test_the_cache_is_bounded_and_older_states_are_rebuilt(q, env, entries, start, end, split):
    client, _ = _client(q, [split["b0"], split["b1"]], split["accs"])
    b1 = _batch(client, env["rollup_id"], 1)
    both = [(start, split["mid"]), (split["mid"], end)]
    for size in (2, 0):  # 0 is raised to the minimum of 2 (the empty ledger and one more)
        ranges: list = []
        validate = qledger_validator(
            client, env["rollup_id"], read_entries=_reader(entries, start, ranges),
            max_cached_states=size,
        )
        assert validate(b1) is True
        assert ranges == both
        # Only the empty ledger and the newest state fit, so batch 1's parent is replayed again.
        ranges.clear()
        assert validate(b1) is True
        assert ranges == both


def test_a_root_no_honest_replay_reaches_is_undecided_and_the_earlier_batch_is_flagged(
    q, env, entries, start, split
):
    bad0 = {**split["b0"], "state_root": "ef" * 32}
    on0 = {**split["b1"], "prev_state_root": bad0["state_root"]}
    client, _ = _client(q, [bad0, on0], split["accs"])
    validate = qledger_validator(client, env["rollup_id"], read_entries=_reader(entries, start))
    assert validate(_batch(client, env["rollup_id"], 0)) is False
    with pytest.raises(ValueError, match="no honest replay"):
        validate(_batch(client, env["rollup_id"], 1))


def test_skips_rejected_batches_while_replaying(q, env, entries, start, split):
    rejected = {**split["b0"], "status": "rejected", "state_root": "ef" * 32}
    resubmitted = {**split["b0"]}
    client, _ = _client(q, [rejected, resubmitted, split["b1"]], split["accs"])
    validate = qledger_validator(client, env["rollup_id"], read_entries=_reader(entries, start))
    assert validate(_batch(client, env["rollup_id"], 1)) is True


def test_concurrent_judgements_are_serialized(q, env, entries, start, split):
    client, _ = _client(q, [split["b0"], split["b1"]], split["accs"])
    b1 = _batch(client, env["rollup_id"], 1)
    guard = threading.Lock()
    state = {"active": 0, "peak": 0}
    inner = _reader(entries, start)

    def read(**kw):
        with guard:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        try:
            time.sleep(0.005)
            return inner(**kw)
        finally:
            with guard:
                state["active"] -= 1

    validate = qledger_validator(client, env["rollup_id"], read_entries=read)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: validate(b1), range(8)))
    assert results == [True] * 8
    assert state["peak"] == 1
