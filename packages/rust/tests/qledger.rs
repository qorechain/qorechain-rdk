//! qledger-v1 (chain v3.2.8+): transactions, the state tree, execution,
//! withdrawals, fraud proofs and the batch admission rules, checked against
//! the shared vectors in `v328.json` (generated from the chain's own qledger
//! package).
//!
//! Most tests run execution with a verifier that accepts exactly the
//! signatures the vectors mark as valid, so they test the model on its own;
//! `signs_and_verifies_with_the_built_in_mldsa44` runs the real ML-DSA-44
//! signer and verifier against the same vectors.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::{json, Value};

use qorechain_rdk::accounts::NativeAccount;
use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Method, Transport};
use qorechain_rdk::client::rest::RestClient;
use qorechain_rdk::client::views::{map_batch_view, map_submitter_bond_view};
use qorechain_rdk::inbox::{inbox_range_hash, posted_data_hash, InboxRangeInput};
use qorechain_rdk::qledger::*;
use qorechain_rdk::tx::messages::SubmitBatchInput;
use qorechain_rdk::tx::{RdkTxClient, TxOptions};
use qorechain_rdk::zk::{
    to_canonical_scalar, withdrawals_root_matches, zk_public_input_errors, zk_public_inputs,
    ZkBatchInputs, BLS12_381_SCALAR_MODULUS,
};
use qorechain_rdk::{
    DEFAULT_POSTED_DATA_RETENTION_BLOCKS, MAX_POSTED_DATA_RETENTION_BLOCKS,
    MIN_POSTED_DATA_RETENTION_BLOCKS,
};

const GOLDEN_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

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

fn id32(s: &str) -> [u8; 32] {
    unhex(s).try_into().unwrap()
}

fn sv(v: &Value) -> &str {
    v.as_str().unwrap()
}

fn entries(q: &Value) -> Vec<QledgerEntry> {
    q["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| QledgerEntry {
            height: e["height"].as_u64().unwrap(),
            poster: sv(&e["poster"]).to_string(),
            payload: unhex(sv(&e["payload"])),
        })
        .collect()
}

/// `(public_key, message, signature)` of every validly signed transaction in
/// the vectors.
type Known = HashSet<(Vec<u8>, Vec<u8>, Vec<u8>)>;

fn known_signatures(q: &Value) -> Known {
    let (chain, rollup) = (sv(&q["chainId"]), sv(&q["rollupId"]));
    let mut payloads: Vec<Vec<u8>> = q["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| !sv(&e["note"]).starts_with("bad signature"))
        .map(|e| unhex(sv(&e["payload"])))
        .collect();
    payloads.push(unhex(sv(&q["txs"]["t1"]["encoded"])));
    payloads.push(unhex(sv(&q["txs"]["t2"]["encoded"])));
    payloads
        .iter()
        .filter_map(|p| decode_qledger_tx(p))
        .map(|tx| {
            let msg = tx.signing_message(chain, rollup).to_vec();
            (tx.public_key, msg, tx.signature)
        })
        .collect()
}

struct Fixture {
    q: Value,
    entries: Vec<QledgerEntry>,
    known: Known,
}

impl Fixture {
    fn new() -> Self {
        let q = q();
        Fixture {
            entries: entries(&q),
            known: known_signatures(&q),
            q,
        }
    }

    fn verifier(&self) -> impl Fn(&[u8], &[u8], &[u8]) -> bool + '_ {
        move |pk: &[u8], msg: &[u8], sig: &[u8]| {
            self.known
                .contains(&(pk.to_vec(), msg.to_vec(), sig.to_vec()))
        }
    }

    fn chain(&self) -> &str {
        sv(&self.q["chainId"])
    }

    fn rollup(&self) -> &str {
        sv(&self.q["rollupId"])
    }
}

macro_rules! env {
    ($f:expr, $v:expr) => {
        QledgerEnv {
            chain_id: $f.chain(),
            rollup_id: $f.rollup(),
            verifier: &$v,
        }
    };
}

#[test]
fn empty_root_counter_slot_and_account_keys() {
    let q = q();
    assert_eq!(h(&qledger_empty_root()), sv(&q["emptyRoot"]));
    assert_eq!(
        h(&qledger_withdrawal_counter_id()),
        sv(&q["withdrawalCounterId"])
    );
    for a in q["accounts"].as_array().unwrap() {
        let kp = qledger_keypair_from_seed(&unhex(sv(&a["seed"]))).unwrap();
        assert_eq!(h(&kp.public_key), sv(&a["publicKey"]));
        assert_eq!(h(&kp.account_id), sv(&a["id"]));
    }
    assert!(qledger_keypair_from_seed(&[1u8; 31]).is_err());
}

#[test]
fn encodes_transactions_byte_for_byte() {
    let f = Fixture::new();
    let q = &f.q;
    let a = qledger_keypair_from_seed(&unhex(sv(&q["accounts"][0]["seed"]))).unwrap();
    // The vectors' deterministic signatures, handed back for their messages.
    let sig_for = |name: &str| {
        let enc = unhex(sv(&q["txs"][name]["encoded"]));
        let msg = unhex(sv(&q["txs"][name]["signingMessage"]));
        move |m: &[u8; 32]| -> Result<Vec<u8>, String> {
            if m.as_slice() == msg.as_slice() {
                Ok(enc[enc.len() - QLEDGER_MLDSA44_SIGNATURE_SIZE..].to_vec())
            } else {
                Err("unexpected signing message".to_string())
            }
        }
    };

    let to = id32(sv(&q["accounts"][1]["id"]));
    let t1 = QledgerTx::transfer(a.public_key.clone(), 0, to, 1_000_000)
        .sign_with(f.chain(), f.rollup(), sig_for("t1"))
        .unwrap();
    assert_eq!(
        h(&qledger_tx_unsigned(&t1)),
        sv(&q["txs"]["t1"]["unsigned"])
    );
    assert_eq!(
        h(&qledger_signing_message(
            f.chain(),
            f.rollup(),
            &t1.unsigned()
        )),
        sv(&q["txs"]["t1"]["signingMessage"])
    );
    assert_eq!(h(&encode_qledger_tx(&t1)), sv(&q["txs"]["t1"]["encoded"]));
    assert_eq!(t1.from_account(), a.account_id);

    let recipient = sv(&q["recipient"]);
    let t2 = QledgerTx::withdraw(a.public_key.clone(), 1, recipient, 700_000)
        .unwrap()
        .sign_with(f.chain(), f.rollup(), sig_for("t2"))
        .unwrap();
    assert_eq!(h(&t2.encode()), sv(&q["txs"]["t2"]["encoded"]));

    assert!(QledgerTx::withdraw(a.public_key.clone(), 1, &"q".repeat(91), 1).is_err());
    assert!(QledgerTx::withdraw(a.public_key.clone(), 1, "", 1).is_err());

    let parsed = decode_qledger_tx(&unhex(sv(&q["txs"]["t2"]["encoded"]))).unwrap();
    assert_eq!(parsed.recipient_str(), Some(recipient));
    assert_eq!(parsed, t2);
    let v = f.verifier();
    assert!(verify_qledger_tx(&parsed, f.chain(), f.rollup(), &v));
    assert!(!verify_qledger_tx(&parsed, f.chain(), "other-rollup", &v));

    // Anything but exactly one well-formed transaction is refused.
    let enc = t2.encode();
    assert!(decode_qledger_tx(&enc[..enc.len() - 1]).is_none());
    assert!(decode_qledger_tx(&[enc.as_slice(), &[0]].concat()).is_none());
    assert!(decode_qledger_tx(b"not a transaction").is_none());
}

#[test]
fn executes_every_entry_to_the_chains_root_including_the_no_ops() {
    let f = Fixture::new();
    let v = f.verifier();
    let env = env!(f, v);
    let mut led = QledgerLedger::new();
    for (i, e) in f.q["entries"].as_array().unwrap().iter().enumerate() {
        execute_qledger(&env, &mut led, &f.entries[i..i + 1]).unwrap();
        assert_eq!(h(&led.root()), sv(&e["rootAfter"]), "{}", sv(&e["note"]));
    }
}

#[test]
fn produces_the_batch_roots_withdrawals_and_proofs() {
    let f = Fixture::new();
    let v = f.verifier();
    let env = env!(f, v);
    let q = &f.q;
    let res = execute_qledger(&env, &mut QledgerLedger::new(), &f.entries).unwrap();
    assert_eq!(h(&res.state_root), sv(&q["batch"]["stateRoot"]));
    assert_eq!(h(&res.withdrawals_root), sv(&q["batch"]["withdrawalsRoot"]));
    let want: Vec<(u64, String, u64)> = q["batch"]["withdrawals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            (
                w["index"].as_u64().unwrap(),
                sv(&w["recipient"]).to_string(),
                w["amount"].as_u64().unwrap(),
            )
        })
        .collect();
    let got: Vec<(u64, String, u64)> = res
        .withdrawals
        .iter()
        .map(|w| (w.index, w.recipient.clone(), w.amount))
        .collect();
    assert_eq!(got, want);
    for (i, w) in res.withdrawals.iter().enumerate() {
        assert_eq!(
            h(&qledger_withdrawal_leaf(
                f.chain(),
                f.rollup(),
                w.index,
                &w.recipient,
                w.amount
            )),
            sv(&q["batch"]["withdrawals"][i]["leaf"])
        );
        let proof = qledger_withdrawal_proof(f.chain(), f.rollup(), &res.withdrawals, i).unwrap();
        let proof: Vec<String> = proof.iter().map(|p| h(p)).collect();
        let want: Vec<String> = q["batch"]["proofs"][i]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| sv(p).to_string())
            .collect();
        assert_eq!(proof, want);
    }
    assert!(qledger_withdrawal_proof(f.chain(), f.rollup(), &res.withdrawals, 2).is_err());
    assert!(qledger_withdrawals_root(f.chain(), f.rollup(), &[]).is_empty());

    let recipient = sv(&q["recipient"]).to_string();
    let later: Vec<QledgerWithdrawal> = [5u64, 6, 7]
        .iter()
        .enumerate()
        .map(|(k, &index)| QledgerWithdrawal {
            index,
            recipient: recipient.clone(),
            amount: k as u64 + 1,
        })
        .collect();
    assert_eq!(
        h(&qledger_withdrawals_root(f.chain(), f.rollup(), &later)),
        sv(&q["laterWithdrawals"]["root"])
    );
    let proof: Vec<String> = qledger_withdrawal_proof(f.chain(), f.rollup(), &later, 2)
        .unwrap()
        .iter()
        .map(|p| h(p))
        .collect();
    let want: Vec<String> = q["laterWithdrawals"]["proofOfIndex7"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| sv(p).to_string())
        .collect();
    assert_eq!(proof, want);
}

#[test]
fn builds_the_chains_witnesses_and_a_partial_tree_recomputes_the_root() {
    let f = Fixture::new();
    let v = f.verifier();
    let env = env!(f, v);
    let mut led = QledgerLedger::new();
    execute_qledger(&env, &mut led, &f.entries).unwrap();
    let wa = &f.q["witnessesAfterBatch"];
    assert_eq!(h(&led.root()), sv(&wa["root"]));
    let mut ws = Vec::new();
    for w in wa["witnesses"].as_array().unwrap() {
        let got = led.witness(&id32(sv(&w["id"])));
        assert_eq!(h(&got.id), sv(&w["id"]));
        assert_eq!(got.balance, w["balance"].as_u64().unwrap());
        assert_eq!(got.nonce, w["nonce"].as_u64().unwrap());
        assert_eq!(h(&got.bitmap), sv(&w["bitmap"]));
        let sibs: Vec<String> = got.siblings.iter().map(|s| h(s)).collect();
        let want: Vec<String> = w["siblings"]
            .as_array()
            .map(|a| a.iter().map(|s| sv(s).to_string()).collect())
            .unwrap_or_default();
        assert_eq!(sibs, want);
        ws.push(got);
    }
    let mut tree = QledgerPartialTree::new(&led.root(), &ws).unwrap();
    let id = id32(sv(&wa["witnesses"][3]["id"]));
    tree.set(&id, 1, 0).unwrap();
    led.put(&id, 1, 0);
    assert_eq!(QledgerState::root(&tree), led.root());
    assert!(matches!(
        tree.get(&[9u8; 32]),
        Err(QledgerError::IncompleteWitness)
    ));

    // A witness against another root is refused.
    assert!(matches!(
        QledgerPartialTree::new(&[0u8; 32], &ws),
        Err(QledgerError::BadWitness)
    ));
}

#[test]
fn builds_the_chains_fraud_proof_and_decides_it_as_the_chain_does() {
    let f = Fixture::new();
    let v = f.verifier();
    let env = env!(f, v);
    let fr = &f.q["fraud"];
    let mut parent = QledgerLedger::new();
    execute_qledger(&env, &mut parent, &f.entries[..2]).unwrap();
    assert_eq!(h(&parent.root()), sv(&fr["parentRoot"]));
    let (proof, honest) = build_qledger_fraud_proof(
        &env,
        &parent,
        &unhex(sv(&f.q["batch"]["accFrom"])),
        &f.entries[2..],
    )
    .unwrap();
    assert_eq!(h(&proof), sv(&fr["proof"]));
    assert_eq!(h(&honest.state_root), sv(&fr["honestStateRoot"]));
    assert_eq!(
        h(&encode_qledger_fraud_proof(
            &decode_qledger_fraud_proof(&proof).unwrap()
        )),
        sv(&fr["proof"])
    );
    assert!(matches!(
        decode_qledger_fraud_proof(&proof[..proof.len() - 1]),
        Err(QledgerError::MalformedFraudProof)
    ));

    let claim = QledgerClaim {
        inbox_start: fr["inboxStart"].as_u64().unwrap(),
        inbox_end: fr["inboxEnd"].as_u64().unwrap(),
        data_hash: unhex(sv(&fr["dataHash"])),
        prev_state_root: unhex(sv(&fr["parentRoot"])),
        state_root: unhex(sv(&fr["honestStateRoot"])),
        withdrawals_root: unhex(sv(&fr["honestWithdrawalsRoot"])),
    };
    assert!(!check_qledger_fraud(&env, &claim, &proof).unwrap());
    let wrong = QledgerClaim {
        state_root: unhex(sv(&fr["wrongStateRoot"])),
        ..claim.clone()
    };
    assert!(check_qledger_fraud(&env, &wrong, &proof).unwrap());
    let off_range = QledgerClaim {
        inbox_end: claim.inbox_end + 1,
        ..claim.clone()
    };
    let e = check_qledger_fraud(&env, &off_range, &proof).unwrap_err();
    assert!(e.to_string().contains("does not apply"), "{e}");
    let other_data = QledgerClaim {
        data_hash: vec![0u8; 32],
        ..claim.clone()
    };
    let e = check_qledger_fraud(&env, &other_data, &proof).unwrap_err();
    assert!(e.to_string().contains("does not apply"), "{e}");
}

#[test]
fn canonical_recipients_and_deposit_payloads() {
    let f = Fixture::new();
    let recipient = sv(&f.q["recipient"]);
    assert!(is_canonical_qor_address(recipient));
    assert!(!is_canonical_qor_address(&recipient.to_uppercase()));
    assert!(!is_canonical_qor_address(
        "cosmos1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnuddlrw"
    ));
    assert!(!is_canonical_qor_address("qor1"));
    let dep = &f.entries[0];
    assert!(dep.poster.starts_with(QLEDGER_DEPOSIT_POSTER_PREFIX));
    let a = id32(sv(&f.q["accounts"][0]["id"]));
    assert_eq!(encode_qledger_deposit(&a, 5_000_000), dep.payload);
    assert_eq!(decode_qledger_deposit(&dep.payload), Some((a, 5_000_000)));
    assert!(decode_qledger_deposit(&dep.payload[1..]).is_none());
}

// --- admission rules ---

fn base() -> QledgerBatchFacts {
    QledgerBatchFacts {
        bond: 2_000_000_000,
        min_bond: 1_000_000_000,
        pending: 0,
        end_retained: true,
        ..Default::default()
    }
}

fn range(consumed: u64, head: u64, end: u64) -> QledgerBatchFacts {
    QledgerBatchFacts {
        consumed,
        head,
        end,
        ..base()
    }
}

fn errs(f: QledgerBatchFacts) -> String {
    qledger_batch_errors(&f).join("; ")
}

#[test]
fn qledger_constants() {
    assert_eq!(QLEDGER_FRESH_POST_BLOCKS, 20);
    assert_eq!(QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER, 1024);
    assert_eq!(QLEDGER_CHECKPOINT_INTERVAL, 64);
    assert_eq!(QLEDGER_SLASH_BURN_PERCENT, 50);
    assert_eq!(QLEDGER_MAX_BATCH_ENTRIES, 64);
    assert_eq!(DEFAULT_POSTED_DATA_RETENTION_BLOCKS, 648_000);
    assert_eq!(MIN_POSTED_DATA_RETENTION_BLOCKS, 100);
    assert_eq!(MAX_POSTED_DATA_RETENTION_BLOCKS, 25_920_000);
}

#[test]
fn checkpoints_are_non_zero_multiples_of_64() {
    let got: Vec<bool> = [0u64, 1, 63, 64, 128]
        .into_iter()
        .map(is_qledger_checkpoint)
        .collect();
    assert_eq!(got, [false, false, false, true, true]);
}

#[test]
fn bond_pending_cap_range_and_size() {
    assert!(qledger_batch_errors(&range(0, 10, 10)).is_empty());
    assert!(errs(QledgerBatchFacts {
        bond: 1,
        ..range(0, 10, 10)
    })
    .contains("bond"));
    assert!(errs(QledgerBatchFacts {
        pending: 1024,
        ..range(0, 10, 10)
    })
    .contains("waiting"));
    assert!(errs(range(5, 10, 5)).contains("at least one"));
    assert!(errs(range(0, 10, 11)).contains("past the head"));
    assert!(errs(range(0, 100, 65)).contains("at most 64"));
    assert!(qledger_batch_errors(&range(0, 100, 64)).is_empty());
}

#[test]
fn a_short_batch_before_the_head_stops_before_a_fresh_post_or_at_an_unretained_checkpoint() {
    let short = |next_retained: Option<bool>, next_height: Option<u64>| QledgerBatchFacts {
        next_retained,
        next_height,
        inclusion_height: Some(1000),
        ..range(0, 100, 10)
    };
    assert!(qledger_batch_errors(&short(Some(true), Some(990))).is_empty());
    assert!(errs(short(Some(true), Some(980))).contains("post 11 must be in it"));
    assert!(errs(QledgerBatchFacts {
        next_retained: Some(false),
        ..range(0, 100, 10)
    })
    .contains("post 11"));
    assert!(qledger_batch_errors(&QledgerBatchFacts {
        next_retained: Some(false),
        ..range(40, 300, 64)
    })
    .is_empty());
    assert!(errs(QledgerBatchFacts {
        end_retained: false,
        next_retained: Some(false),
        ..range(0, 300, 20)
    })
    .contains("no longer retained"));
}

#[test]
fn chooses_the_end_the_chain_recommends() {
    let all = |_: u64| Ok::<_, Infallible>(true);
    assert_eq!(choose_qledger_batch_end(5, 5, all).unwrap(), None);
    assert_eq!(choose_qledger_batch_end(0, 10, all).unwrap(), Some(10));
    assert_eq!(choose_qledger_batch_end(0, 200, all).unwrap(), Some(64));
    // After a long idle period only checkpoints kept their commitments.
    let only_checkpoints = |x: u64| Ok::<_, Infallible>(x.is_multiple_of(64));
    assert_eq!(
        choose_qledger_batch_end(40, 500, only_checkpoints).unwrap(),
        Some(64)
    );
    assert_eq!(
        choose_qledger_batch_end(64, 500, only_checkpoints).unwrap(),
        Some(128)
    );
}

// --- Groth16 withdrawals root modulo r ---

fn plus_r(k: u8) -> [u8; 32] {
    // r + k, with no carry past the last byte for small k (r ends in 0x01).
    let mut v = BLS12_381_SCALAR_MODULUS;
    v[31] += k;
    v
}

#[test]
fn any_32_byte_withdrawals_root_passes_and_the_circuit_takes_it_mod_r() {
    let high = plus_r(5);
    let mut low = [0u8; 32];
    low[31] = 5;
    assert!(zk_public_input_errors(
        &ZkBatchInputs {
            state_root: &low,
            withdrawals_root: &high,
            ..Default::default()
        },
        false
    )
    .is_empty());
    let e = zk_public_input_errors(
        &ZkBatchInputs {
            state_root: &high,
            ..Default::default()
        },
        false,
    );
    assert!(e.join("; ").contains("state_root"));
    let ins = zk_public_inputs(&ZkBatchInputs {
        prev_state_root: &low,
        state_root: &low,
        withdrawals_root: &high,
        ..Default::default()
    });
    assert_eq!(ins, [low, low, [0u8; 32], to_canonical_scalar(&high)]);
    assert_eq!(ins[3], low);
}

#[test]
fn compares_mod_r_only_when_the_chain_reduced_the_stored_root() {
    let high = plus_r(5);
    let mut low = [0u8; 32];
    low[31] = 5;
    assert!(withdrawals_root_matches(&low, &high, true));
    assert!(!withdrawals_root_matches(&low, &high, false));
    assert!(withdrawals_root_matches(&high, &high, false));
}

#[test]
fn views_carry_the_reduced_flag_and_pending_batches() {
    let b = map_batch_view(&json!({ "withdrawals_root_reduced": true }));
    assert!(b.withdrawals_root_reduced);
    assert!(!map_batch_view(&json!({})).withdrawals_root_reduced);
    let bond = map_submitter_bond_view(&json!({ "amount": "5", "pending": "3" }));
    assert_eq!(bond.pending, 3);
    assert_eq!(map_submitter_bond_view(&json!({})).pending, 0);
}

// --- a node serving a qledger-v1 rollup whose inbox holds the vectors ---

struct FakeNode {
    routes: Mutex<HashMap<String, Value>>,
    posts: Vec<Value>,
    deposits: Vec<Value>,
    urls: Mutex<Vec<String>>,
    /// Paths answered with HTTP 500.
    fail: Mutex<Vec<String>>,
}

impl FakeNode {
    fn set(&self, path: &str, body: Value) {
        self.routes.lock().unwrap().insert(path.to_string(), body);
    }

    fn posted(&self) -> bool {
        self.urls
            .lock()
            .unwrap()
            .iter()
            .any(|u| u.ends_with("/cosmos/tx/v1beta1/txs"))
    }
}

impl Transport for FakeNode {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let path = request.url.replace("http://node", "");
        self.urls.lock().unwrap().push(path.clone());
        let ok = |body: Value| {
            Ok(HttpResponse {
                status: 200,
                body: body.to_string(),
            })
        };
        if self.fail.lock().unwrap().contains(&path) {
            return Ok(HttpResponse {
                status: 500,
                body: "{}".into(),
            });
        }
        if request.method == Method::Post && path == "/cosmos/tx/v1beta1/txs" {
            return ok(json!({ "tx_response": { "code": 0, "txhash": "ABCD" } }));
        }
        if let Some(rest) = path.strip_prefix("/cosmos/tx/v1beta1/txs?query=") {
            let txs = if rest.starts_with("rdk_data_posted") {
                &self.posts
            } else {
                &self.deposits
            };
            return ok(json!({ "tx_responses": txs, "total": txs.len().to_string() }));
        }
        match self.routes.lock().unwrap().get(&path) {
            Some(body) => ok(body.clone()),
            None => Ok(HttpResponse {
                status: 404,
                body: "{}".into(),
            }),
        }
    }
}

/// `(node, range data hash up to the head)`.
fn fake_node(f: &Fixture) -> (Arc<FakeNode>, String) {
    let (chain, rollup) = (f.chain(), f.rollup());
    let head = f.entries.len() as u64;
    let acc_to = qledger_accumulate(chain, rollup, 0, &[], &f.entries);
    let range = h(&inbox_range_hash(&InboxRangeInput {
        chain_id: chain,
        rollup_id: rollup,
        from: 0,
        to: head,
        acc_from: &[],
        acc_to: &acc_to,
    }));
    let mut posts = Vec::new();
    let mut deposits = Vec::new();
    for (i, e) in f.entries.iter().enumerate() {
        let seq = (i + 1).to_string();
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
    let inbox = json!({ "inbox": {
        "head_sequence": head.to_string(),
        "consumed_sequence": "0",
        "consumed_acc": "00".repeat(32),
        "head_acc": h(&acc_to),
        "range_end": head.to_string(),
        "range_data_hash": range,
    }});
    let mut routes = HashMap::new();
    routes.insert(
        format!("/qorechain/rdk/v1/rollup/{rollup}"),
        json!({ "rollup": { "rollup_id": rollup, "execution_vm": "qledger-v1", "sequencing": "based", "settlement_mode": "optimistic" } }),
    );
    routes.insert(
        "/qorechain/rdk/v1/params".to_string(),
        json!({ "params": { "min_submitter_bond": "1000000000" } }),
    );
    routes.insert(format!("/qorechain/rdk/v1/inbox/{rollup}"), inbox.clone());
    routes.insert(
        format!("/qorechain/rdk/v1/inbox/{rollup}?inbox_end={head}"),
        inbox,
    );
    routes.insert(
        format!("/qorechain/rdk/v1/posted_data/{rollup}/{head}"),
        json!({ "posted_data": { "sequence": head.to_string(), "inbox_acc": h(&acc_to) } }),
    );
    routes.insert(
        "/cosmos/base/node/v1beta1/status".to_string(),
        json!({ "height": "1000" }),
    );
    let node = Arc::new(FakeNode {
        routes: Mutex::new(routes),
        posts,
        deposits,
        urls: Mutex::new(Vec::new()),
        fail: Mutex::new(Vec::new()),
    });
    (node, range)
}

#[test]
fn rest_latest_height_and_tx_search() {
    let f = Fixture::new();
    let (node, _) = fake_node(&f);
    let rest = RestClient::with_transport("http://node", node.clone());
    assert_eq!(rest.get_latest_height().unwrap(), 1000);
    let txs = rest.search_txs("rdk_data_posted.rollup_id='r'").unwrap();
    assert_eq!(txs.len(), node.posts.len());
    let urls = node.urls.lock().unwrap().clone();
    assert!(urls.iter().any(|u| u
        == "/cosmos/tx/v1beta1/txs?query=rdk_data_posted.rollup_id%3D%27r%27&page=1&limit=100&order_by=ORDER_BY_ASC"));
    node.set("/cosmos/base/node/v1beta1/status", json!({}));
    assert!(rest.get_latest_height().is_err());
}

#[test]
fn fetches_and_verifies_the_entries_from_the_chain() {
    let f = Fixture::new();
    let (node, _) = fake_node(&f);
    let rest = RestClient::with_transport("http://node", node.clone());
    let input = QledgerFetchInput {
        chain_id: f.chain(),
        rollup_id: f.rollup(),
        from: 0,
        to: f.entries.len() as u64,
        acc_from: &[],
    };
    assert_eq!(fetch_qledger_entries(&rest, &input).unwrap(), f.entries);

    // An accumulator that does not match the bytes is refused.
    let head = f.entries.len();
    let posted = format!("/qorechain/rdk/v1/posted_data/{}/{head}", f.rollup());
    node.set(
        &posted,
        json!({ "posted_data": { "inbox_acc": "00".repeat(32) } }),
    );
    let e = fetch_qledger_entries(&rest, &input).unwrap_err();
    assert!(e.to_string().contains("do not match"), "{e}");

    // Pruned commitment of the head: the head accumulator decides.
    node.routes.lock().unwrap().remove(&posted);
    assert_eq!(fetch_qledger_entries(&rest, &input).unwrap(), f.entries);

    // Pruned commitment before the head: refused, never returned unchecked.
    let short = QledgerFetchInput { to: 5, ..input };
    let e = fetch_qledger_entries(&rest, &short).unwrap_err();
    assert!(e.to_string().contains("no longer retains"), "{e}");

    // Only a 404 reads as pruned; another failure is returned.
    node.set(&posted, json!(null));
    node.fail.lock().unwrap().push(posted.clone());
    let e = fetch_qledger_entries(&rest, &input).unwrap_err();
    assert!(matches!(e, QledgerError::Rest(_)), "{e}");
}

#[test]
fn plans_the_first_batch_from_the_chain_and_reproduces_the_chains_roots() {
    let f = Fixture::new();
    let (node, range) = fake_node(&f);
    let bond_path = format!("/qorechain/rdk/v1/submitter_bond/{}/qor1sub", f.rollup());
    node.set(
        &bond_path,
        json!({ "amount": "1000000000", "pending": "0" }),
    );
    let rest = RestClient::with_transport("http://node", node.clone());
    let v = f.verifier();
    let ledger = QledgerLedger::new();
    let input = QledgerPlanInput {
        chain_id: f.chain(),
        rollup_id: f.rollup(),
        submitter: "qor1sub",
        ledger: &ledger,
        verifier: &v,
        inclusion_margin: None,
    };
    let plan = plan_qledger_batch(&rest, &input).unwrap();
    assert_eq!(plan.input.inbox_end, f.entries.len() as u64);
    assert_eq!(plan.input.batch_index, 0);
    assert_eq!(plan.input.prev_state_root, qledger_empty_root().to_vec());
    assert_eq!(h(&plan.input.state_root), sv(&f.q["batch"]["stateRoot"]));
    assert_eq!(
        h(&plan.input.withdrawals_root),
        sv(&f.q["batch"]["withdrawalsRoot"])
    );
    assert_eq!(h(&plan.input.data_hash), range);
    assert_eq!(plan.input.tx_count, f.entries.len() as u64);
    assert_eq!(plan.result.withdrawals.len(), 2);
    assert_eq!(h(&plan.ledger.root()), sv(&f.q["batch"]["stateRoot"]));

    node.set(&bond_path, json!({ "amount": "5", "pending": "0" }));
    let e = plan_qledger_batch(&rest, &input).unwrap_err();
    assert!(e.to_string().contains("bond"), "{e}");

    // A ledger that is not the rollup's latest state is refused.
    node.set(
        &bond_path,
        json!({ "amount": "1000000000", "pending": "0" }),
    );
    let mut other = QledgerLedger::new();
    other.put(&[1u8; 32], 1, 0);
    let e = plan_qledger_batch(
        &rest,
        &QledgerPlanInput {
            ledger: &other,
            ..input
        },
    )
    .unwrap_err();
    assert!(e.to_string().contains("latest state root"), "{e}");

    // Only a 404 from the latest-batch query means "no batch yet".
    node.fail
        .lock()
        .unwrap()
        .push(format!("/qorechain/rdk/v1/latest_batch/{}", f.rollup()));
    let e = plan_qledger_batch(&rest, &input).unwrap_err();
    assert!(matches!(e, QledgerError::Rest(_)), "{e}");
}

#[test]
fn submit_batch_checks_the_qledger_admission_rules() {
    let f = Fixture::new();
    let (node, range) = fake_node(&f);
    let account = NativeAccount::from_mnemonic_default(GOLDEN_MNEMONIC).unwrap();
    let rest = RestClient::with_transport("http://node", node.clone());
    let client = RdkTxClient::new(account, rest, f.chain(), 0, 0);
    let bond_path = format!(
        "/qorechain/rdk/v1/submitter_bond/{}/{}",
        f.rollup(),
        client.address()
    );
    let o = TxOptions::default();
    let batch = |inbox_end: u64| SubmitBatchInput {
        rollup_id: f.rollup().to_string(),
        batch_index: 0,
        prev_state_root: qledger_empty_root().to_vec(),
        state_root: unhex(sv(&f.q["batch"]["stateRoot"])),
        data_hash: unhex(&range),
        withdrawals_root: unhex(sv(&f.q["batch"]["withdrawalsRoot"])),
        inbox_end,
        ..Default::default()
    };
    let head = f.entries.len() as u64;

    node.set(&bond_path, json!({ "amount": "5", "pending": "0" }));
    let e = client
        .submit_batch(batch(head), &o)
        .unwrap_err()
        .to_string();
    assert!(e.contains("bond"), "{e}");
    node.set(
        &bond_path,
        json!({ "amount": "1000000000", "pending": "1024" }),
    );
    let e = client
        .submit_batch(batch(head), &o)
        .unwrap_err()
        .to_string();
    assert!(e.contains("waiting for finality"), "{e}");
    node.set(
        &bond_path,
        json!({ "amount": "1000000000", "pending": "0" }),
    );
    let e = client
        .submit_batch(batch(head + 1), &o)
        .unwrap_err()
        .to_string();
    assert!(e.contains("past the head"), "{e}");
    assert!(!node.posted());

    client.submit_batch(batch(head), &o).unwrap();
    assert!(node.posted());
}

#[test]
fn signs_and_verifies_with_the_built_in_mldsa44() {
    use qorechain_rdk::qledger::MLDSA44_VERIFIER;
    let f = Fixture::new();
    let q = &f.q;
    let a = qledger_keypair_from_seed(&unhex(sv(&q["accounts"][0]["seed"]))).unwrap();
    let to = id32(sv(&q["accounts"][1]["id"]));
    let t1 = QledgerTx::transfer(a.public_key.clone(), 0, to, 1_000_000)
        .sign(f.chain(), f.rollup(), &a.secret_key)
        .unwrap();
    assert_eq!(h(&t1.encode()), sv(&q["txs"]["t1"]["encoded"]));
    let t2 = QledgerTx::withdraw(a.public_key.clone(), 1, sv(&q["recipient"]), 700_000)
        .unwrap()
        .sign(f.chain(), f.rollup(), &a.secret_key)
        .unwrap();
    assert_eq!(h(&t2.encode()), sv(&q["txs"]["t2"]["encoded"]));
    assert!(verify_qledger_tx(
        &t2,
        f.chain(),
        f.rollup(),
        &MLDSA44_VERIFIER
    ));
    assert!(!verify_qledger_tx(
        &t2,
        f.chain(),
        "other-rollup",
        &MLDSA44_VERIFIER
    ));
    assert!(QledgerTx::transfer(a.public_key.clone(), 0, to, 1)
        .sign(f.chain(), f.rollup(), &[0u8; 3])
        .is_err());

    // The whole batch, every entry checked by the real verifier.
    let env = QledgerEnv {
        chain_id: f.chain(),
        rollup_id: f.rollup(),
        verifier: &MLDSA44_VERIFIER,
    };
    let mut led = QledgerLedger::new();
    for (i, e) in q["entries"].as_array().unwrap().iter().enumerate() {
        execute_qledger(&env, &mut led, &f.entries[i..i + 1]).unwrap();
        assert_eq!(h(&led.root()), sv(&e["rootAfter"]), "{}", sv(&e["note"]));
    }
}
