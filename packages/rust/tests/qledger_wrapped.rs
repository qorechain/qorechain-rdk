//! Posts reach a rollup's inbox through every wrapper the chain executes on
//! someone's behalf. A watcher that cannot read one back cannot check (or
//! challenge) the batch that consumes it, so the fetcher must find every one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::{json, Value};

use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::rest::{RestClient, RestError};
use qorechain_rdk::inbox::posted_data_hash;
use qorechain_rdk::qledger::*;

fn q() -> Value {
    let v: Value = serde_json::from_str(include_str!("v328.json")).expect("v328.json parses");
    v["qledger"].clone()
}

fn entries(q: &Value) -> Vec<QledgerEntry> {
    q["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| QledgerEntry {
            height: e["height"].as_u64().unwrap(),
            poster: e["poster"].as_str().unwrap().to_string(),
            payload: hex::decode(e["payload"].as_str().unwrap()).unwrap(),
        })
        .collect()
}

fn is_deposit(e: &QledgerEntry) -> bool {
    e.poster.starts_with(QLEDGER_DEPOSIT_POSTER_PREFIX)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Shape {
    Top,
    Exec,
    Nested,
    Mixed,
    GroupTry,
    GroupLater,
    Lost,
}

/// The entries as the chain records them for `shape` (a mixed transaction
/// lands all its posts at one height).
fn effective(shape: Shape, entries: &[QledgerEntry]) -> Vec<QledgerEntry> {
    let last = entries.iter().rfind(|e| !is_deposit(e)).unwrap().height;
    entries
        .iter()
        .map(|e| {
            let mut e = e.clone();
            if shape == Shape::Mixed && !is_deposit(&e) {
                e.height = last;
            }
            e
        })
        .collect()
}

fn post_msg(rollup: &str, e: &QledgerEntry) -> Value {
    json!({ "@type": "/qorechain.rdk.v1.MsgPostRollupData", "poster": e.poster, "rollup_id": rollup, "data": BASE64.encode(&e.payload) })
}

fn exec(msgs: Vec<Value>) -> Value {
    json!({ "@type": "/cosmos.authz.v1beta1.MsgExec", "grantee": "qor1grantee", "msgs": msgs })
}

fn send() -> Value {
    json!({ "@type": "/cosmos.bank.v1beta1.MsgSend", "from_address": "qor1x", "to_address": "qor1y", "amount": [{ "denom": "uqor", "amount": "1" }] })
}

struct Node {
    posts: Vec<Value>,
    deposits: Vec<Value>,
    submits: HashMap<String, Vec<Value>>,
    routes: HashMap<String, Value>,
    queries: Mutex<Vec<String>>,
}

fn decode_query(s: &str) -> String {
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap());
            i += 3;
        } else {
            out.push(if b[i] == b'+' { b' ' } else { b[i] });
            i += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

impl Transport for Node {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let path = request.url.replace("http://node", "");
        let ok = |body: Value| {
            Ok(HttpResponse {
                status: 200,
                body: body.to_string(),
            })
        };
        if let Some(rest) = path.strip_prefix("/cosmos/tx/v1beta1/txs?query=") {
            let query = decode_query(rest.split('&').next().unwrap());
            self.queries.lock().unwrap().push(query.clone());
            let none = Vec::new();
            let txs = if query.starts_with("rdk_data_posted.") {
                &self.posts
            } else if query.starts_with("rdk_rollup_deposit.") {
                &self.deposits
            } else if let Some(id) = query
                .strip_prefix("cosmos.group.v1.EventSubmitProposal.proposal_id='\"")
                .and_then(|r| r.strip_suffix("\"'"))
            {
                self.submits.get(id).unwrap_or(&none)
            } else {
                &none
            };
            return ok(json!({ "tx_responses": txs, "total": txs.len().to_string() }));
        }
        if path.starts_with("/cosmos/group/v1/proposal/") {
            // An executed group proposal is pruned: the node answers 500 "not found".
            return Ok(HttpResponse {
                status: 500,
                body: "{\"code\":2}".into(),
            });
        }
        match self.routes.get(&path) {
            Some(b) => ok(b.clone()),
            None => Ok(HttpResponse {
                status: 404,
                body: "{}".into(),
            }),
        }
    }
}

fn node(shape: Shape) -> (Arc<Node>, Vec<QledgerEntry>, String, String) {
    let q = q();
    let (chain, rollup) = (
        q["chainId"].as_str().unwrap().to_string(),
        q["rollupId"].as_str().unwrap().to_string(),
    );
    let entries = effective(shape, &entries(&q));
    let head = entries.len() as u64;
    let acc_to = qledger_accumulate(&chain, &rollup, 0, &[], &entries);
    let (mut posts, mut deposits, mut submits) = (Vec::new(), Vec::new(), HashMap::new());
    let (mut mixed_msgs, mut mixed_events, mut mixed_height) = (vec![send()], Vec::new(), 0u64);
    for (i, e) in entries.iter().enumerate() {
        let seq = (i + 1).to_string();
        if let Some(depositor) = e.poster.strip_prefix(QLEDGER_DEPOSIT_POSTER_PREFIX) {
            let (account, amount) = decode_qledger_deposit(&e.payload).unwrap();
            deposits.push(json!({
                "height": e.height.to_string(), "txhash": format!("D{seq}"),
                "events": [{ "type": "rdk_rollup_deposit", "attributes": [
                    { "key": "rollup_id", "value": rollup }, { "key": "depositor", "value": depositor },
                    { "key": "account", "value": hex::encode(account) }, { "key": "amount", "value": format!("{amount}uqor") },
                    { "key": "sequence", "value": seq },
                ]}],
            }));
            continue;
        }
        let event = json!({ "type": "rdk_data_posted", "attributes": [
            { "key": "rollup_id", "value": rollup }, { "key": "sequence", "value": seq },
            { "key": "data_hash", "value": hex::encode(posted_data_hash(&e.payload)) }, { "key": "poster", "value": e.poster },
        ]});
        let tx = |msgs: Vec<Value>| json!({ "height": e.height.to_string(), "txhash": format!("P{seq}"), "tx": { "body": { "messages": msgs } }, "events": [event.clone()] });
        let post = post_msg(&rollup, e);
        match shape {
            Shape::Top => posts.push(tx(vec![post])),
            Shape::Exec => posts.push(tx(vec![exec(vec![post])])),
            Shape::Nested => posts.push(tx(vec![exec(vec![exec(vec![exec(vec![post])])])])),
            Shape::Mixed => {
                // One transaction: a top-level post, posts under one and two MsgExec levels.
                let m = match mixed_msgs.len() % 3 {
                    0 => post,
                    1 => exec(vec![post]),
                    _ => exec(vec![send(), exec(vec![post])]),
                };
                mixed_msgs.push(m);
                mixed_events.push(event.clone());
                mixed_height = e.height;
            }
            Shape::GroupTry => posts.push(tx(vec![json!({
                "@type": "/cosmos.group.v1.MsgSubmitProposal", "group_policy_address": "qor1policy",
                "proposers": ["qor1member"], "messages": [post], "exec": "EXEC_TRY",
            })])),
            Shape::GroupLater => {
                // Submitted (inside a MsgExec) in one transaction, executed by MsgExec of x/group in another.
                let id = (100 + i + 1).to_string();
                submits.insert(id.clone(), vec![json!({
                    "height": (e.height - 1).to_string(), "txhash": format!("S{seq}"), "events": [],
                    "tx": { "body": { "messages": [exec(vec![json!({
                        "@type": "/cosmos.group.v1.MsgSubmitProposal", "group_policy_address": "qor1policy",
                        "proposers": ["qor1member"], "messages": [post],
                    })])] } },
                })]);
                posts.push(tx(vec![json!({ "@type": "/cosmos.group.v1.MsgExec", "proposal_id": id, "executor": "qor1member" })]));
            }
            Shape::Lost => posts.push(tx(vec![json!({
                // The event is there, the bytes are not (a contract or governance post).
                "@type": "/cosmwasm.wasm.v1.MsgExecuteContract", "sender": "qor1s", "contract": "qor1c", "msg": {},
            })])),
        }
    }
    if shape == Shape::Mixed {
        posts.push(json!({ "height": mixed_height.to_string(), "txhash": "MIXED", "tx": { "body": { "messages": mixed_msgs } }, "events": mixed_events }));
    }
    let mut routes = HashMap::new();
    routes.insert(
        format!("/qorechain/rdk/v1/posted_data/{rollup}/{head}"),
        json!({ "posted_data": { "sequence": head.to_string(), "inbox_acc": hex::encode(&acc_to) } }),
    );
    let n = Arc::new(Node {
        posts,
        deposits,
        submits,
        routes,
        queries: Mutex::new(Vec::new()),
    });
    (n, entries, chain, rollup)
}

fn read(
    shape: Shape,
) -> (
    Result<Vec<QledgerEntry>, QledgerError>,
    Vec<QledgerEntry>,
    Arc<Node>,
    String,
) {
    let (n, want, chain, rollup) = node(shape);
    let rest = RestClient::with_transport("http://node", n.clone());
    let input = QledgerFetchInput {
        chain_id: &chain,
        rollup_id: &rollup,
        from: 0,
        to: want.len() as u64,
        acc_from: &[],
    };
    (fetch_qledger_entries(&rest, &input), want, n, rollup)
}

#[test]
fn finds_posts_through_every_wrapper() {
    for shape in [
        Shape::Top,
        Shape::Exec,
        Shape::Nested,
        Shape::Mixed,
        Shape::GroupTry,
        Shape::GroupLater,
    ] {
        let (got, want, _, _) = read(shape);
        assert_eq!(
            got.unwrap_or_else(|e| panic!("{shape:?}: {e}")),
            want,
            "{shape:?}"
        );
    }
}

#[test]
fn asks_only_for_the_sequences_it_needs() {
    let (got, want, n, rollup) = read(Shape::Top);
    got.unwrap();
    let head = want.len();
    let qs = n.queries.lock().unwrap().clone();
    for event in ["rdk_data_posted", "rdk_rollup_deposit"] {
        let q = format!(
            "{event}.rollup_id='{rollup}' AND {event}.sequence>0 AND {event}.sequence<={head}"
        );
        assert!(qs.contains(&q), "{qs:?} lacks {q}");
    }
}

#[test]
fn refuses_a_post_whose_bytes_are_in_no_transaction() {
    let e = read(Shape::Lost).0.unwrap_err();
    assert!(e.to_string().contains("cannot be read back"), "{e}");
}

#[test]
fn matches_every_post_of_a_mixed_transaction_and_bounds_nesting() {
    let q = q();
    let rollup = q["rollupId"].as_str().unwrap();
    let posts: Vec<QledgerEntry> = entries(&q)
        .into_iter()
        .filter(|e| !is_deposit(e))
        .take(3)
        .collect();
    let msgs = json!([
        send(),
        post_msg(rollup, &posts[0]),
        exec(vec![post_msg(rollup, &posts[1])]),
        exec(vec![send(), exec(vec![post_msg(rollup, &posts[2])])]),
    ]);
    let mut found = PostedPayloads::default();
    collect_posted_payloads(&msgs, &mut found).unwrap();
    assert_eq!(found.payloads.len(), 3);
    for p in &posts {
        assert_eq!(
            found.payloads[&hex::encode(posted_data_hash(&p.payload))],
            p.payload
        );
    }

    let mut deep = post_msg(rollup, &posts[0]);
    for _ in 0..40 {
        deep = exec(vec![deep]);
    }
    let e = collect_posted_payloads(&json!([deep]), &mut PostedPayloads::default()).unwrap_err();
    assert!(e.to_string().contains("nest deeper"), "{e}");
}

struct Endless;

impl Transport for Endless {
    fn send(&self, _request: HttpRequest) -> Result<HttpResponse, HttpError> {
        Ok(HttpResponse {
            status: 200,
            body: json!({ "tx_responses": [{ "txhash": "a" }, { "txhash": "b" }], "total": "10" })
                .to_string(),
        })
    }
}

#[test]
fn search_txs_refuses_partial_lists() {
    let rest = RestClient::with_transport("http://node", Arc::new(Endless));
    let e = rest.search_txs_with("x.y='z'", 2, 3).unwrap_err();
    assert!(
        matches!(e, RestError::TooManyResults { limit: 6, .. }),
        "{e}"
    );
    assert_eq!(rest.search_txs_with("x.y='z'", 2, 5).unwrap().len(), 10);
}
