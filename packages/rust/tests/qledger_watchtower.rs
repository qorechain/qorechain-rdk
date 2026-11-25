//! Watching a qledger-v1 rollup: the judge decides each batch as the chain
//! decides a challenge against it, by re-executing the batch's inbox entries
//! from its parent state. The batch is the `v328.json` qledger batch (11 inbox
//! entries, sequences 4 to 14, settled from the empty ledger, with the roots
//! the chain accepted), and every signature is checked by the real ML-DSA-44
//! verifier.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::{json, Value};

use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::views::BatchView;
use qorechain_rdk::client::{RdkClient, RdkClientOptions};
use qorechain_rdk::inbox::{inbox_range_hash, posted_data_hash, InboxRangeInput};
use qorechain_rdk::qledger::*;
use qorechain_rdk::transition::{batch_transition_root, TransitionInput, TransitionRootVersion};

fn q() -> Value {
    let v: Value = serde_json::from_str(include_str!("v328.json")).expect("v328.json parses");
    v["qledger"].clone()
}

fn h(b: &[u8]) -> String {
    hex::encode(b)
}

fn unhex(s: &str) -> Vec<u8> {
    hex::decode(s).unwrap()
}

fn sv(v: &Value) -> &str {
    v.as_str().unwrap()
}

struct Fixture {
    q: Value,
    entries: Vec<QledgerEntry>,
    start: u64,
    end: u64,
}

impl Fixture {
    fn new() -> Self {
        let q = q();
        let entries = q["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| QledgerEntry {
                height: e["height"].as_u64().unwrap(),
                poster: sv(&e["poster"]).to_string(),
                payload: unhex(sv(&e["payload"])),
            })
            .collect();
        let start = q["batch"]["inboxStart"].as_u64().unwrap();
        let end = q["batch"]["inboxEnd"].as_u64().unwrap();
        // The client's network is the testnet, which the vectors are for.
        assert_eq!(sv(&q["chainId"]), qorechain_rdk::TESTNET_CHAIN_ID);
        Fixture {
            q,
            entries,
            start,
            end,
        }
    }

    fn chain(&self) -> &str {
        sv(&self.q["chainId"])
    }

    fn rollup(&self) -> &str {
        sv(&self.q["rollupId"])
    }

    fn acc_from(&self) -> Vec<u8> {
        unhex(sv(&self.q["batch"]["accFrom"]))
    }

    fn env(&self) -> QledgerEnv<'_> {
        QledgerEnv {
            chain_id: self.chain(),
            rollup_id: self.rollup(),
            verifier: &MLDSA44_VERIFIER,
        }
    }

    /// The batch the chain accepted, as the node lists it.
    fn honest_batch(&self) -> Value {
        let b = &self.q["batch"];
        json!({
            "rollup_id": self.rollup(),
            "batch_index": "0",
            "status": "submitted",
            "prev_state_root": sv(&self.q["emptyRoot"]),
            "state_root": sv(&b["stateRoot"]),
            "withdrawals_root": sv(&b["withdrawalsRoot"]),
            "data_hash": sv(&b["dataHash"]),
            "tx_count": self.entries.len().to_string(),
            "inbox_start": self.start.to_string(),
            "inbox_end": self.end.to_string(),
            "submitted_at": "100",
            "withdrawals_bound": true,
        })
    }

    /// The fixture's accumulator at the batch's start, by sequence.
    fn accs_one_batch(&self) -> Vec<(u64, Vec<u8>)> {
        vec![(self.start, self.acc_from())]
    }

    /// Entries `from + 1 ..= to`, as a node's transaction index would return
    /// them.
    fn reader(&self, list: Vec<QledgerEntry>) -> QledgerEntryReader {
        let start = self.start;
        Box::new(move |r: &QledgerFetchInput<'_>| {
            Ok(list[(r.from - start) as usize..(r.to - start) as usize].to_vec())
        })
    }

    /// A reader that also records each range it was asked for.
    fn recording_reader(&self, ranges: Arc<Mutex<Vec<(u64, u64)>>>) -> QledgerEntryReader {
        let mut inner = self.reader(self.entries.clone());
        Box::new(move |r: &QledgerFetchInput<'_>| {
            ranges.lock().unwrap().push((r.from, r.to));
            inner(r)
        })
    }

    fn options(&self) -> QledgerValidatorOptions {
        with_reader(self.reader(self.entries.clone()))
    }
}

fn with_reader(read: QledgerEntryReader) -> QledgerValidatorOptions {
    QledgerValidatorOptions {
        read_entries: Some(read),
        ..Default::default()
    }
}

// --- a node serving one qledger-v1 rollup ---

struct Node {
    routes: HashMap<String, Value>,
    posts: Vec<Value>,
    deposits: Vec<Value>,
    urls: Mutex<Vec<String>>,
}

impl Node {
    fn searched_txs(&self) -> bool {
        self.urls
            .lock()
            .unwrap()
            .iter()
            .any(|u| u.starts_with("/cosmos/tx/v1beta1/txs"))
    }
}

impl Transport for Node {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let path = request.url.replace("http://node", "");
        self.urls.lock().unwrap().push(path.clone());
        let ok = |body: Value| {
            Ok(HttpResponse {
                status: 200,
                body: body.to_string(),
            })
        };
        if let Some(query) = path.strip_prefix("/cosmos/tx/v1beta1/txs?query=") {
            let txs = if query.starts_with("rdk_data_posted") {
                &self.posts
            } else {
                &self.deposits
            };
            return ok(json!({ "tx_responses": txs, "total": txs.len().to_string() }));
        }
        let route = path.split('?').next().unwrap_or_default();
        match self.routes.get(route) {
            Some(body) => ok(body.clone()),
            None => Ok(HttpResponse {
                status: 404,
                body: json!({ "code": 5, "message": "not found" }).to_string(),
            }),
        }
    }
}

/// The rollup's `batches` and the inbox accumulator after each post in `accs`.
fn routes(f: &Fixture, batches: Vec<Value>, accs: &[(u64, Vec<u8>)]) -> HashMap<String, Value> {
    let rollup = f.rollup();
    let mut routes = HashMap::new();
    routes.insert(
        format!("/qorechain/rdk/v1/batches/{rollup}"),
        json!({ "batches": batches, "next_index": "0" }),
    );
    for (seq, acc) in accs {
        routes.insert(
            format!("/qorechain/rdk/v1/posted_data/{rollup}/{seq}"),
            json!({ "posted_data": { "sequence": seq.to_string(), "inbox_acc": h(acc) } }),
        );
    }
    routes
}

/// A client on the testnet whose REST calls `node` answers.
fn serve(node: Node) -> (RdkClient, Arc<Node>) {
    let node = Arc::new(node);
    let client = RdkClient::new(RdkClientOptions {
        rest_url: Some("http://node".to_string()),
        transport: Some(node.clone()),
        ..Default::default()
    });
    (client, node)
}

/// A node serving [`routes`] and no transactions.
fn node(f: &Fixture, batches: Vec<Value>, accs: &[(u64, Vec<u8>)]) -> (RdkClient, Arc<Node>) {
    serve(Node {
        routes: routes(f, batches, accs),
        posts: Vec::new(),
        deposits: Vec::new(),
        urls: Mutex::new(Vec::new()),
    })
}

fn batch_view(client: &RdkClient, rollup: &str, index: i64) -> BatchView {
    client
        .rest
        .list_batches(rollup)
        .unwrap()
        .into_iter()
        .find(|b| b.batch_index == index)
        .unwrap_or_else(|| panic!("no batch {index}"))
}

fn claim_of(b: &Value) -> QledgerClaim {
    let n = |k: &str| sv(&b[k]).parse::<u64>().unwrap();
    QledgerClaim {
        inbox_start: n("inbox_start"),
        inbox_end: n("inbox_end"),
        data_hash: unhex(sv(&b["data_hash"])),
        prev_state_root: unhex(sv(&b["prev_state_root"])),
        state_root: unhex(sv(&b["state_root"])),
        withdrawals_root: unhex(sv(&b["withdrawals_root"])),
    }
}

#[test]
fn the_transition_root_of_an_honest_qledger_batch_is_not_its_state_root() {
    // Why the qledger judge exists: the transition-root rule would flag this
    // honest batch under either binding.
    let f = Fixture::new();
    let b = &f.q["batch"];
    let input = TransitionInput {
        chain_id: f.chain().to_string(),
        rollup_id: f.rollup().to_string(),
        prev_state_root: unhex(sv(&f.q["emptyRoot"])),
        data_hash: unhex(sv(&b["dataHash"])),
        tx_count: f.entries.len() as u64,
        withdrawals_root: unhex(sv(&b["withdrawalsRoot"])),
    };
    for version in [TransitionRootVersion::V1, TransitionRootVersion::V2] {
        let root = batch_transition_root(&input, version).unwrap();
        assert_ne!(h(&root), sv(&b["stateRoot"]));
    }
}

#[test]
fn accepts_the_honest_batch_with_no_proof_to_send_against_it() {
    let f = Fixture::new();
    let (client, _) = node(&f, vec![f.honest_batch()], &f.accs_one_batch());
    let b = batch_view(&client, f.rollup(), 0);

    let mut validate = qledger_validator(&client, f.rollup(), f.options());
    assert!(validate(&b).unwrap());
    assert_eq!(
        qledger_fraud_proof_for_batch(&client, f.rollup(), &b, f.options()).unwrap(),
        None
    );

    let j = QledgerJudge::new(&client, f.rollup(), f.options())
        .judge(&b)
        .unwrap();
    assert!(j.valid);
    assert_eq!(j.proof, None);
    assert_eq!(h(&j.honest.state_root), sv(&f.q["batch"]["stateRoot"]));
    assert_eq!(
        h(&j.honest.withdrawals_root),
        sv(&f.q["batch"]["withdrawalsRoot"])
    );

    // The predicate owns its judge, so it can run on a polling thread.
    let mut on_thread = qledger_validator(&client, f.rollup(), f.options());
    let judged = std::thread::spawn(move || on_thread(&b)).join().unwrap();
    assert!(judged.unwrap());
}

#[test]
fn a_wrong_state_root_is_invalid_with_a_proof_the_chains_check_upholds() {
    let f = Fixture::new();
    let mut wrong = f.honest_batch();
    wrong["state_root"] = json!("ab".repeat(32));
    let (client, _) = node(&f, vec![wrong.clone()], &f.accs_one_batch());
    let b = batch_view(&client, f.rollup(), 0);

    assert!(!qledger_validator(&client, f.rollup(), f.options())(&b).unwrap());
    let j = QledgerJudge::new(&client, f.rollup(), f.options())
        .judge(&b)
        .unwrap();
    assert!(!j.valid);
    assert_eq!(h(&j.honest.state_root), sv(&f.q["batch"]["stateRoot"]));
    let proof = qledger_fraud_proof_for_batch(&client, f.rollup(), &b, f.options())
        .unwrap()
        .expect("a proof against the wrong root");
    assert_eq!(j.proof.as_deref(), Some(proof.as_slice()));

    let claim = claim_of(&wrong);
    assert!(check_qledger_fraud(&f.env(), &claim, &proof).unwrap());
    // The same proof does not win against the honest roots.
    let honest = QledgerClaim {
        state_root: unhex(sv(&f.q["batch"]["stateRoot"])),
        ..claim
    };
    assert!(!check_qledger_fraud(&f.env(), &honest, &proof).unwrap());
}

#[test]
fn a_wrong_withdrawals_root_is_invalid() {
    let f = Fixture::new();
    let mut wrong = f.honest_batch();
    wrong["withdrawals_root"] = json!("cd".repeat(32));
    let (client, _) = node(&f, vec![wrong.clone()], &f.accs_one_batch());
    let b = batch_view(&client, f.rollup(), 0);

    assert!(!qledger_validator(&client, f.rollup(), f.options())(&b).unwrap());
    let proof = qledger_fraud_proof_for_batch(&client, f.rollup(), &b, f.options())
        .unwrap()
        .expect("a proof against the wrong withdrawals root");
    assert!(check_qledger_fraud(&f.env(), &claim_of(&wrong), &proof).unwrap());
}

#[test]
fn entries_that_do_not_belong_to_the_batch_leave_it_undecided_rather_than_invalid() {
    let f = Fixture::new();
    let (client, _) = node(&f, vec![f.honest_batch()], &f.accs_one_batch());
    let b = batch_view(&client, f.rollup(), 0);
    let short = f.entries[..f.entries.len() - 1].to_vec();
    let short_reader: QledgerEntryReader =
        Box::new(move |_: &QledgerFetchInput<'_>| Ok(short.clone()));

    let e = qledger_validator(&client, f.rollup(), with_reader(short_reader))(&b).unwrap_err();
    assert!(matches!(e, QledgerError::NotApplicable(_)), "{e}");
    assert!(e.to_string().contains("does not apply"), "{e}");

    // Entries of the right length but not the batch's: still undecided.
    let mut other = f.entries.clone();
    other.swap(1, 2);
    let e = qledger_fraud_proof_for_batch(&client, f.rollup(), &b, with_reader(f.reader(other)))
        .unwrap_err();
    assert!(matches!(e, QledgerError::NotApplicable(_)), "{e}");
}

#[test]
fn the_injected_reader_gets_the_batch_range_and_its_start_accumulator() {
    let f = Fixture::new();
    let (client, node) = node(&f, vec![f.honest_batch()], &f.accs_one_batch());
    let b = batch_view(&client, f.rollup(), 0);
    type Seen = Vec<(String, String, u64, u64, Vec<u8>)>;
    let seen: Arc<Mutex<Seen>> = Arc::default();
    let log = seen.clone();
    let entries = f.entries.clone();
    let read: QledgerEntryReader = Box::new(move |r: &QledgerFetchInput<'_>| {
        log.lock().unwrap().push((
            r.chain_id.to_string(),
            r.rollup_id.to_string(),
            r.from,
            r.to,
            r.acc_from.to_vec(),
        ));
        Ok(entries.clone())
    });

    assert!(qledger_validator(&client, f.rollup(), with_reader(read))(&b).unwrap());
    assert_eq!(
        *seen.lock().unwrap(),
        vec![(
            f.chain().to_string(),
            f.rollup().to_string(),
            f.start,
            f.end,
            f.acc_from()
        )]
    );
    // The node's transaction index is not read when a reader is injected.
    assert!(!node.searched_txs());
}

#[test]
fn reads_the_entries_from_the_nodes_transaction_index_by_default() {
    let f = Fixture::new();
    let rollup = f.rollup();
    let acc_end = qledger_accumulate(f.chain(), rollup, f.start, &f.acc_from(), &f.entries);
    // The node serves roots base64-encoded.
    let mut honest = f.honest_batch();
    for k in [
        "prev_state_root",
        "state_root",
        "withdrawals_root",
        "data_hash",
    ] {
        honest[k] = json!(BASE64.encode(unhex(sv(&honest[k]))));
    }
    let mut posts = Vec::new();
    let mut deposits = Vec::new();
    for (i, e) in f.entries.iter().enumerate() {
        let seq = (f.start + i as u64 + 1).to_string();
        if let Some(depositor) = e.poster.strip_prefix(QLEDGER_DEPOSIT_POSTER_PREFIX) {
            let (account, amount) = decode_qledger_deposit(&e.payload).unwrap();
            deposits.push(json!({
                "height": e.height.to_string(),
                "txhash": format!("D{seq}"),
                "events": [{ "type": "rdk_rollup_deposit", "attributes": [
                    { "key": "rollup_id", "value": rollup },
                    { "key": "depositor", "value": depositor },
                    { "key": "account", "value": h(&account) },
                    { "key": "amount", "value": format!("{amount}uqor") },
                    { "key": "sequence", "value": seq },
                ]}],
            }));
        } else {
            posts.push(json!({
                "height": e.height.to_string(),
                "txhash": format!("P{seq}"),
                "tx": { "body": { "messages": [{
                    "@type": "/qorechain.rdk.v1.MsgPostRollupData",
                    "poster": e.poster,
                    "rollup_id": rollup,
                    "data": BASE64.encode(&e.payload),
                }]}},
                "events": [{ "type": "rdk_data_posted", "attributes": [
                    { "key": "rollup_id", "value": rollup },
                    { "key": "sequence", "value": seq },
                    { "key": "data_hash", "value": h(&posted_data_hash(&e.payload)) },
                    { "key": "poster", "value": e.poster },
                ]}],
            }));
        }
    }
    let (client, node) = serve(Node {
        routes: routes(
            &f,
            vec![honest],
            &[(f.start, f.acc_from()), (f.end, acc_end)],
        ),
        posts,
        deposits,
        urls: Mutex::new(Vec::new()),
    });
    let b = batch_view(&client, rollup, 0);

    let mut validate = qledger_validator(&client, rollup, QledgerValidatorOptions::default());
    assert!(validate(&b).unwrap());
    assert!(node.searched_txs());
}

#[test]
fn the_verifier_option_checks_the_signatures() {
    // A verifier that refuses every signature leaves only the deposits, so the
    // batch the chain accepted no longer reproduces.
    let f = Fixture::new();
    let (client, _) = node(&f, vec![f.honest_batch()], &f.accs_one_batch());
    let b = batch_view(&client, f.rollup(), 0);
    let refuse_all = |_: &[u8], _: &[u8], _: &[u8]| false;
    let options = QledgerValidatorOptions {
        verifier: Some(Box::new(refuse_all)),
        ..f.options()
    };
    assert!(!qledger_validator(&client, f.rollup(), options)(&b).unwrap());
}

// --- across batches: the fixture's entries split into two batches ---

struct TwoBatches {
    f: Fixture,
    b0: Value,
    b1: Value,
    accs: Vec<(u64, Vec<u8>)>,
    mid: u64,
}

fn two_batches() -> TwoBatches {
    let f = Fixture::new();
    let cut = 5;
    let (first, second) = f.entries.split_at(cut);
    let mid = f.start + cut as u64;
    let mut ledger = QledgerLedger::new();
    let r1 = execute_qledger(&f.env(), &mut ledger, first).unwrap();
    let r2 = execute_qledger(&f.env(), &mut ledger, second).unwrap();
    let (chain, rollup) = (f.chain(), f.rollup());
    let acc_from = f.acc_from();
    let acc_mid = qledger_accumulate(chain, rollup, f.start, &acc_from, first);
    let acc_end = qledger_accumulate(chain, rollup, mid, &acc_mid, second);
    let data_hash = |from: u64, to: u64, acc_from: &[u8], acc_to: &[u8]| {
        h(&inbox_range_hash(&InboxRangeInput {
            chain_id: chain,
            rollup_id: rollup,
            from,
            to,
            acc_from,
            acc_to,
        }))
    };
    let mut b0 = f.honest_batch();
    b0["state_root"] = json!(h(&r1.state_root));
    b0["withdrawals_root"] = json!(h(&r1.withdrawals_root));
    b0["data_hash"] = json!(data_hash(f.start, mid, &acc_from, &acc_mid));
    b0["tx_count"] = json!(first.len().to_string());
    b0["inbox_end"] = json!(mid.to_string());
    let mut b1 = f.honest_batch();
    b1["batch_index"] = json!("1");
    b1["prev_state_root"] = json!(h(&r1.state_root));
    b1["state_root"] = json!(h(&r2.state_root));
    b1["withdrawals_root"] = json!(h(&r2.withdrawals_root));
    b1["data_hash"] = json!(data_hash(mid, f.end, &acc_mid, &acc_end));
    b1["tx_count"] = json!(second.len().to_string());
    b1["inbox_start"] = json!(mid.to_string());
    b1["submitted_at"] = json!("101");
    let accs = vec![(f.start, acc_from.clone()), (mid, acc_mid)];
    TwoBatches {
        f,
        b0,
        b1,
        accs,
        mid,
    }
}

#[test]
fn rebuilds_the_parent_state_by_replaying_earlier_batches_then_uses_the_cache() {
    let t = two_batches();
    let f = &t.f;
    let (client, _) = node(f, vec![t.b0.clone(), t.b1.clone()], &t.accs);
    let ranges: Arc<Mutex<Vec<(u64, u64)>>> = Arc::default();
    let mut validate = qledger_validator(
        &client,
        f.rollup(),
        with_reader(f.recording_reader(ranges.clone())),
    );
    let b1 = batch_view(&client, f.rollup(), 1);
    assert!(validate(&b1).unwrap());
    assert_eq!(
        *ranges.lock().unwrap(),
        vec![(f.start, t.mid), (t.mid, f.end)]
    );
    // The state after batch 0 is now known, so judging batch 1 again reads only
    // its own entries.
    ranges.lock().unwrap().clear();
    assert!(validate(&b1).unwrap());
    assert_eq!(*ranges.lock().unwrap(), vec![(t.mid, f.end)]);

    // Judging batch 0 needs only the empty ledger, which is always kept.
    ranges.lock().unwrap().clear();
    assert!(validate(&batch_view(&client, f.rollup(), 0)).unwrap());
    assert_eq!(*ranges.lock().unwrap(), vec![(f.start, t.mid)]);
}

#[test]
fn a_small_cache_rebuilds_evicted_states_by_replay() {
    let t = two_batches();
    let f = &t.f;
    let (client, _) = node(f, vec![t.b0.clone(), t.b1.clone()], &t.accs);
    let ranges: Arc<Mutex<Vec<(u64, u64)>>> = Arc::default();
    // Below the floor of 2: the empty ledger and one more state are kept.
    let options = QledgerValidatorOptions {
        max_cached_states: Some(0),
        ..with_reader(f.recording_reader(ranges.clone()))
    };
    let mut judge = QledgerJudge::new(&client, f.rollup(), options);
    let b1 = batch_view(&client, f.rollup(), 1);
    assert!(judge.judge(&b1).unwrap().valid);
    // The state after batch 1 evicted the one after batch 0, so the replay
    // runs again.
    ranges.lock().unwrap().clear();
    assert!(judge.judge(&b1).unwrap().valid);
    assert_eq!(
        *ranges.lock().unwrap(),
        vec![(f.start, t.mid), (t.mid, f.end)]
    );
}

#[test]
fn a_batch_on_a_root_no_honest_replay_reaches_is_undecided_and_the_earlier_batch_is_flagged() {
    let t = two_batches();
    let f = &t.f;
    let mut bad0 = t.b0.clone();
    bad0["state_root"] = json!("ef".repeat(32));
    let mut on0 = t.b1.clone();
    on0["prev_state_root"] = bad0["state_root"].clone();
    let (client, _) = node(f, vec![bad0, on0], &t.accs);
    let mut validate = qledger_validator(&client, f.rollup(), f.options());

    assert!(!validate(&batch_view(&client, f.rollup(), 0)).unwrap());
    let e = validate(&batch_view(&client, f.rollup(), 1)).unwrap_err();
    assert!(matches!(e, QledgerError::InvalidInput(_)), "{e}");
    assert!(e.to_string().contains("no honest replay"), "{e}");
    assert!(e.to_string().contains(&"ef".repeat(32)), "{e}");
}

#[test]
fn skips_rejected_batches_while_replaying() {
    let t = two_batches();
    let f = &t.f;
    let mut rejected = t.b0.clone();
    rejected["status"] = json!("rejected");
    rejected["state_root"] = json!("ef".repeat(32));
    let resubmitted = t.b0.clone();
    let (client, _) = node(f, vec![rejected, resubmitted, t.b1.clone()], &t.accs);
    let ranges: Arc<Mutex<Vec<(u64, u64)>>> = Arc::default();
    let mut validate = qledger_validator(
        &client,
        f.rollup(),
        with_reader(f.recording_reader(ranges.clone())),
    );

    assert!(validate(&batch_view(&client, f.rollup(), 1)).unwrap());
    // The rejected batch is never re-executed.
    assert_eq!(
        *ranges.lock().unwrap(),
        vec![(f.start, t.mid), (t.mid, f.end)]
    );
}
