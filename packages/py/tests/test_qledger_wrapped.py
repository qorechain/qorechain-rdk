"""Posts reach a rollup's inbox through every wrapper the chain executes on
someone's behalf. A watcher that cannot read one back cannot check (or
challenge) the batch that consumes it, so the fetcher must find every one."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import replace
from urllib.parse import unquote

import pytest

from qorrdk import (
    HttpResponse,
    QledgerEntry,
    RestClient,
    collect_posted_payloads,
    decode_qledger_deposit,
    fetch_qledger_entries,
    inbox_range_hash,
    posted_data_hash,
    qledger_accumulate,
)

POST = "/qorechain.rdk.v1.MsgPostRollupData"
SEND = {"@type": "/cosmos.bank.v1beta1.MsgSend", "from_address": "qor1x", "to_address": "qor1y",
        "amount": [{"denom": "uqor", "amount": "1"}]}


@pytest.fixture(scope="module")
def q(v328) -> dict:
    return v328["qledger"]


@pytest.fixture(scope="module")
def entries(q) -> list:
    return [
        QledgerEntry(height=e["height"], poster=e["poster"], payload=bytes.fromhex(e["payload"]))
        for e in q["entries"]
    ]


def _deposit(e: QledgerEntry) -> bool:
    return e.poster.startswith("deposit:")


def _effective(shape: str, entries: list) -> list:
    """The entries as the chain records them (a mixed transaction lands all its posts at one height)."""
    if shape != "mixed":
        return entries
    last = [e for e in entries if not _deposit(e)][-1].height
    return [e if _deposit(e) else replace(e, height=last) for e in entries]


def _exec(*msgs) -> dict:
    return {"@type": "/cosmos.authz.v1beta1.MsgExec", "grantee": "qor1grantee", "msgs": list(msgs)}


class _Node:
    def __init__(self, q, raw_entries, shape):
        self.chain_id, self.rollup_id = q["chainId"], rid = q["chainId"], q["rollupId"]
        entries = _effective(shape, raw_entries)
        self.head = len(entries)
        self.posts, self.deposits, self.submits, self.queries = [], [], {}, []
        acc = b""
        mixed_msgs, mixed_events, mixed_height = [SEND], [], 0
        for i, e in enumerate(entries):
            acc = qledger_accumulate(chain_id=self.chain_id, rollup_id=rid, from_sequence=i,
                                     acc_from=acc, entries=[e])
            seq = str(i + 1)
            if _deposit(e):
                d = decode_qledger_deposit(e.payload)
                self.deposits.append({"height": str(e.height), "txhash": f"D{seq}", "events": [
                    {"type": "rdk_rollup_deposit", "attributes": [
                        {"key": "rollup_id", "value": rid},
                        {"key": "depositor", "value": e.poster[len("deposit:"):]},
                        {"key": "account", "value": d.account.hex()},
                        {"key": "amount", "value": f"{d.amount}uqor"},
                        {"key": "sequence", "value": seq}]}]})
                continue
            event = {"type": "rdk_data_posted", "attributes": [
                {"key": "rollup_id", "value": rid}, {"key": "sequence", "value": seq},
                {"key": "data_hash", "value": posted_data_hash(e.payload).hex()},
                {"key": "poster", "value": e.poster}]}
            post = {"@type": POST, "poster": e.poster, "rollup_id": rid,
                    "data": base64.b64encode(e.payload).decode()}

            def tx(*msgs, _e=e, _seq=seq, _event=event):
                return {"height": str(_e.height), "txhash": f"P{_seq}",
                        "tx": {"body": {"messages": list(msgs)}}, "events": [_event]}

            if shape == "top":
                self.posts.append(tx(post))
            elif shape == "exec":
                self.posts.append(tx(_exec(post)))
            elif shape == "nested":
                self.posts.append(tx(_exec(_exec(_exec(post)))))
            elif shape == "mixed":
                # One transaction: a top-level post, posts under one and two MsgExec levels.
                k = len(mixed_msgs) % 3
                mixed_msgs.append(post if k == 0 else _exec(post) if k == 1 else _exec(SEND, _exec(post)))
                mixed_events.append(event)
                mixed_height = e.height
            elif shape == "group-try":
                self.posts.append(tx({"@type": "/cosmos.group.v1.MsgSubmitProposal",
                                      "group_policy_address": "qor1policy", "proposers": ["qor1member"],
                                      "messages": [post], "exec": "EXEC_TRY"}))
            elif shape == "group-later":
                # Submitted (inside a MsgExec) in one transaction, executed by MsgExec of x/group in another.
                pid = str(100 + i + 1)
                self.submits.setdefault(pid, []).append({
                    "height": str(e.height - 1), "txhash": f"S{seq}", "events": [],
                    "tx": {"body": {"messages": [_exec({
                        "@type": "/cosmos.group.v1.MsgSubmitProposal", "group_policy_address": "qor1policy",
                        "proposers": ["qor1member"], "messages": [post]})]}}})
                self.posts.append(tx({"@type": "/cosmos.group.v1.MsgExec", "proposal_id": pid,
                                      "executor": "qor1member"}))
            elif shape == "lost":
                # The event is there, the bytes are not (a contract or governance post).
                self.posts.append(tx({"@type": "/cosmwasm.wasm.v1.MsgExecuteContract", "sender": "qor1s",
                                      "contract": "qor1c", "msg": {}}))
        if shape == "mixed":
            self.posts.append({"height": str(mixed_height), "txhash": "MIXED",
                               "tx": {"body": {"messages": mixed_msgs}}, "events": mixed_events})
        self.acc = acc
        self.range = inbox_range_hash(chain_id=self.chain_id, rollup_id=rid, from_sequence=0,
                                      to_sequence=self.head, acc_from=b"", acc_to=acc).hex()

    def __call__(self, method, url, headers=None, body=None):
        path = url.replace("http://node", "")
        ok = lambda b: HttpResponse(200, "OK", json.dumps(b))  # noqa: E731
        if path.startswith("/cosmos/tx/v1beta1/txs?query="):
            query = unquote(path.split("query=")[1].split("&")[0])
            self.queries.append(query)
            txs = []
            if query.startswith("rdk_data_posted."):
                txs = self.posts
            elif query.startswith("rdk_rollup_deposit."):
                txs = self.deposits
            elif query.startswith("cosmos.group.v1.EventSubmitProposal.proposal_id="):
                m = re.search(r"'\"(\d+)\"'", query)
                txs = self.submits.get(m.group(1), []) if m else []
            return ok({"tx_responses": txs, "total": str(len(txs))})
        if path == f"/qorechain/rdk/v1/posted_data/{self.rollup_id}/{self.head}":
            return ok({"posted_data": {"sequence": str(self.head), "inbox_acc": self.acc.hex(), "height": "210"}})
        if path.startswith(f"/qorechain/rdk/v1/inbox/{self.rollup_id}"):
            h = str(self.head)
            return ok({"inbox": {"head_sequence": h, "consumed_sequence": "0", "consumed_acc": "00" * 32,
                                 "range_end": h, "range_data_hash": self.range}})
        if path.startswith("/cosmos/group/v1/proposal/"):
            # An executed group proposal is pruned: the node answers 500 "not found".
            return HttpResponse(500, "Internal Server Error", '{"code":2}')
        return HttpResponse(404, "Not Found", "{}")

    def read(self):
        return fetch_qledger_entries(RestClient("http://node", self), chain_id=self.chain_id,
                                     rollup_id=self.rollup_id, from_sequence=0,
                                     to_sequence=self.head, acc_from=b"")


@pytest.mark.parametrize("shape", ["top", "exec", "nested", "mixed", "group-try", "group-later"])
def test_finds_posts_through_every_wrapper(q, entries, shape):
    got = _Node(q, entries, shape).read()
    want = _effective(shape, entries)
    assert [(e.height, e.poster, e.payload) for e in got] == [(e.height, e.poster, e.payload) for e in want]


def test_asks_only_for_the_sequences_it_needs(q, entries):
    node = _Node(q, entries, "top")
    node.read()
    rid, h = node.rollup_id, node.head
    assert f"rdk_data_posted.rollup_id='{rid}' AND rdk_data_posted.sequence>0 AND rdk_data_posted.sequence<={h}" in node.queries
    assert f"rdk_rollup_deposit.rollup_id='{rid}' AND rdk_rollup_deposit.sequence>0 AND rdk_rollup_deposit.sequence<={h}" in node.queries


def test_refuses_a_post_whose_bytes_are_in_no_transaction(q, entries):
    with pytest.raises(ValueError, match="cannot be read back"):
        _Node(q, entries, "lost").read()


def test_matches_every_post_of_a_mixed_transaction(q, entries):
    posts = [e for e in entries if not _deposit(e)][:3]
    m = [{"@type": POST, "poster": e.poster, "rollup_id": q["rollupId"],
          "data": base64.b64encode(e.payload).decode()} for e in posts]
    found = collect_posted_payloads([SEND, m[0], _exec(m[1]), _exec(SEND, _exec(m[2]))])
    assert found.payloads == {posted_data_hash(e.payload).hex(): e.payload for e in posts}


def test_refuses_messages_nested_past_the_bound(q, entries):
    e = [e for e in entries if not _deposit(e)][0]
    m = {"@type": POST, "poster": e.poster, "rollup_id": q["rollupId"], "data": base64.b64encode(e.payload).decode()}
    for _ in range(40):
        m = _exec(m)
    with pytest.raises(ValueError, match="nest deeper"):
        collect_posted_payloads([m])


def test_search_txs_refuses_partial_lists():
    def transport(method, url, headers=None, body=None):
        return HttpResponse(200, "OK", json.dumps({"tx_responses": [{"txhash": "a"}, {"txhash": "b"}], "total": "10"}))

    rest = RestClient("http://node", transport)
    with pytest.raises(RuntimeError, match="more than 6"):
        rest.search_txs("x.y='z'", page_limit=2, max_pages=3)
    assert len(rest.search_txs("x.y='z'", page_limit=2, max_pages=5)) == 10
