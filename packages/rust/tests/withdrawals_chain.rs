//! Withdrawals, DA commitments and the v3.2.5 rules, exactly as the chain
//! builds and enforces them. Every proof in the `withdrawalTree` vectors is
//! accepted by the chain's own VerifyWithdrawalMerkle, and refused at the wrong
//! index.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use qorechain_rdk::accounts::NativeAccount;
use qorechain_rdk::bridge::withdrawal::{
    withdrawal_leaf_v1, withdrawal_leaf_v2, withdrawals_tree, Withdrawal, WithdrawalLeafInput,
};
use qorechain_rdk::challenge_window::ChainTip;
use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::views::map_rollup_view;
use qorechain_rdk::client::{RdkClient, RdkClientOptions, RestClient};
use qorechain_rdk::da::build_da_blob;
use qorechain_rdk::health::{get_rollup_health, HealthOptions, HeldBackBy};
use qorechain_rdk::rules::{
    stop_rollup_error, withdrawals_root_error, MAX_PENDING_OPTIMISTIC_BATCHES,
};
use qorechain_rdk::transition::{TransitionRootVersion, FEATURE_RDK_CHALLENGE_SETTLEMENT};
use qorechain_rdk::tx::messages::SubmitBatchInput;
use qorechain_rdk::tx::{RdkTxClient, TxOptions};

const GOLDEN_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn golden() -> Value {
    serde_json::from_str(include_str!("golden.json")).unwrap()
}

fn hex_list(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_string())
        .collect()
}

fn items(w: &Value) -> Vec<Withdrawal> {
    w["withdrawals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| Withdrawal {
            recipient: x["recipient"].as_str().unwrap().to_string(),
            denom: w["denom"].as_str().unwrap().to_string(),
            amount: x["amount"].as_u64().unwrap(),
        })
        .collect()
}

#[test]
fn withdrawals_tree_matches_the_chain() {
    let g = golden();
    let w = &g["withdrawalTree"];
    let rollup_id = w["rollupId"].as_str().unwrap();
    let chain_id = w["chainId"].as_str().unwrap();
    let items = items(w);
    for (version, key) in [
        (TransitionRootVersion::V1, "v1"),
        (TransitionRootVersion::V2, "v2"),
    ] {
        let tree = withdrawals_tree(&items, rollup_id, version, chain_id).unwrap();
        let leaves: Vec<String> = tree.leaves.iter().map(hex::encode).collect();
        assert_eq!(leaves, hex_list(&w[key]["leaves"]), "{key} leaves");
        assert_eq!(
            hex::encode(&tree.root),
            w[key]["root"].as_str().unwrap(),
            "{key} root"
        );
        for i in 0..items.len() {
            let p = tree.proof(i);
            let proof: Vec<String> = p.proof.iter().map(hex::encode).collect();
            assert_eq!(proof, hex_list(&w[key]["proofs"][i]), "{key} proof {i}");
            assert_eq!(
                hex::encode(&p.withdrawals_root),
                w[key]["root"].as_str().unwrap()
            );
            assert_eq!(p.withdrawal_index, i);
        }
    }
    // v1 and v2 trees differ, so a proof cannot cross bindings.
    assert_ne!(w["v1"]["root"], w["v2"]["root"]);
}

#[test]
fn single_leaves_match_the_chain() {
    let g = golden();
    let w = &g["withdrawalTree"];
    let input = WithdrawalLeafInput {
        rollup_id: w["rollupId"].as_str().unwrap().to_string(),
        withdrawal_index: 0,
        recipient: "qor1alice".to_string(),
        denom: "uqor".to_string(),
        amount: 1_500_000,
    };
    assert_eq!(
        hex::encode(withdrawal_leaf_v1(&input)),
        w["v1"]["leaves"][0].as_str().unwrap()
    );
    assert_eq!(
        hex::encode(withdrawal_leaf_v2(w["chainId"].as_str().unwrap(), &input).unwrap()),
        w["v2"]["leaves"][0].as_str().unwrap()
    );
    assert!(withdrawal_leaf_v2("", &input)
        .unwrap_err()
        .contains("chain id"));
}

#[test]
fn withdrawals_tree_refuses_what_the_chain_cannot_build() {
    let g = golden();
    let w = &g["withdrawalTree"];
    assert!(withdrawals_tree(&[], "roll", TransitionRootVersion::V1, "")
        .unwrap_err()
        .contains("at least one"));
    assert!(
        withdrawals_tree(&items(w), "roll", TransitionRootVersion::V2, "")
            .unwrap_err()
            .contains("chain id")
    );
}

#[test]
fn da_blob_commitment_is_the_chains() {
    let g = golden();
    let d = &g["daBlob"];
    let blob = build_da_blob(d["dataUtf8"].as_str().unwrap().as_bytes().to_vec(), None).unwrap();
    assert_eq!(
        blob.data_hash,
        format!("0x{}", d["commitment"].as_str().unwrap())
    );
}

#[test]
fn withdrawals_root_is_empty_or_32_bytes() {
    assert_eq!(withdrawals_root_error(&[]), None);
    assert_eq!(withdrawals_root_error(&[0u8; 32]), None);
    let err = withdrawals_root_error(&[0xab; 31]).unwrap();
    assert!(
        err.contains("withdrawals_root") && err.contains("31"),
        "{err}"
    );
    assert!(withdrawals_root_error(&[0u8; 33]).is_some());
}

#[test]
fn a_rollup_with_an_unsettled_latest_batch_cannot_be_stopped() {
    assert!(stop_rollup_error(Some("submitted"))
        .unwrap()
        .contains("submitted"));
    assert!(stop_rollup_error(Some("challenged"))
        .unwrap()
        .contains("challenged"));
    assert_eq!(stop_rollup_error(Some("finalized")), None);
    assert_eq!(stop_rollup_error(Some("rejected")), None);
    assert_eq!(stop_rollup_error(None), None);
    assert_eq!(MAX_PENDING_OPTIMISTIC_BATCHES, 4096);
}

#[test]
fn rollup_view_maps_has_verification_key() {
    let on = map_rollup_view(&json!({ "rollup_id": "r", "has_verification_key": true }));
    assert!(on.has_verification_key);
    let camel = map_rollup_view(&json!({ "rollupId": "r", "hasVerificationKey": true }));
    assert!(camel.has_verification_key);
    let off = map_rollup_view(&json!({ "rollup_id": "r", "has_verification_key": false }));
    assert!(!off.has_verification_key);
    // Not served: none registered.
    let absent = map_rollup_view(&json!({ "rollup_id": "r" }));
    assert!(!absent.has_verification_key);
}

/// A mock chain: one rollup whose batch 0 is challenged and whose latest
/// batch 1 is submitted, answering by route and recording every URL.
struct MockChain {
    settlement: bool,
    urls: Mutex<Vec<String>>,
}

impl MockChain {
    fn new(settlement: bool) -> Arc<Self> {
        Arc::new(MockChain {
            settlement,
            urls: Mutex::new(Vec::new()),
        })
    }
}

impl Transport for MockChain {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let url = request.url.clone();
        self.urls.lock().unwrap().push(url.clone());
        let body = if url.contains("/protocol_features") {
            json!({ "features": [
                { "name": FEATURE_RDK_CHALLENGE_SETTLEMENT, "enabled": self.settlement },
                { "name": "rdk-withdrawals-binding", "enabled": true },
            ]})
        } else if url.contains("/rdk/v1/rollup/") {
            json!({ "rollup": { "rollup_id": "r", "status": "active", "challenge_window_sec": "600" } })
        } else if url.contains("/rdk/v1/latest_batch/") {
            json!({ "batch": { "rollup_id": "r", "batch_index": "1", "status": "submitted", "submitted_at": "10" } })
        } else if url.contains("/rdk/v1/batches/") {
            json!({ "batches": [
                { "rollup_id": "r", "batch_index": "0", "status": "challenged", "submitted_at": "5" },
                { "rollup_id": "r", "batch_index": "1", "status": "submitted", "submitted_at": "10" },
            ], "next_index": "0" })
        } else if url.ends_with("/cosmos/tx/v1beta1/txs") {
            json!({ "tx_response": { "code": 0, "txhash": "ABCD" } })
        } else {
            return Ok(HttpResponse {
                status: 404,
                body: "{}".into(),
            });
        };
        Ok(HttpResponse {
            status: 200,
            body: body.to_string(),
        })
    }
}

fn health_of(chain: Arc<MockChain>) -> qorechain_rdk::health::RollupHealth {
    let client = RdkClient::new(RdkClientOptions {
        transport: Some(chain),
        ..Default::default()
    });
    get_rollup_health(
        &client,
        "r",
        HealthOptions {
            // 600 s is 100 blocks; batch 1 is 990 blocks old, so its own
            // window has passed.
            tip: Some(ChainTip {
                height: 1_000,
                time_secs: 0,
            }),
            challenge_window_secs: None,
        },
    )
    .unwrap()
}

#[test]
fn health_reports_a_batch_held_back_by_an_earlier_one() {
    let chain = MockChain::new(true);
    let health = health_of(chain.clone());
    assert!(health.challenge_window.unwrap().finalizable);
    assert_eq!(
        health.held_back_by,
        Some(HeldBackBy {
            batch_index: 0,
            status: "challenged".to_string()
        })
    );
    assert!(
        health
            .notes
            .iter()
            .any(|n| n.contains("finalize in order") && n.contains("batch 0 is still challenged")),
        "{:?}",
        health.notes
    );
    // The search starts MAX_PENDING_OPTIMISTIC_BATCHES back, clamped at 0.
    let urls = chain.urls.lock().unwrap();
    assert!(urls
        .iter()
        .any(|u| u.contains("/qorechain/rdk/v1/batches/r") && !u.contains("start_index")));
}

#[test]
fn health_does_not_report_held_back_when_the_feature_is_off() {
    let chain = MockChain::new(false);
    let health = health_of(chain.clone());
    assert!(health.challenge_window.unwrap().finalizable);
    assert_eq!(health.held_back_by, None);
    assert!(!health.notes.iter().any(|n| n.contains("finalize in order")));
    // Nothing was listed.
    assert!(!chain
        .urls
        .lock()
        .unwrap()
        .iter()
        .any(|u| u.contains("/batches/")));
}

fn tx_client(chain: Arc<MockChain>) -> RdkTxClient<NativeAccount> {
    let rest = RestClient::with_transport("http://node.example", chain);
    let account = NativeAccount::from_mnemonic_default(GOLDEN_MNEMONIC).unwrap();
    RdkTxClient::new(account, rest, "qorechain-diana", 0, 0)
}

fn posted(chain: &MockChain) -> bool {
    chain
        .urls
        .lock()
        .unwrap()
        .iter()
        .any(|u| u.ends_with("/cosmos/tx/v1beta1/txs"))
}

#[test]
fn submit_batch_refuses_a_malformed_withdrawals_root_before_broadcast() {
    let chain = MockChain::new(true);
    let tx = tx_client(chain.clone());
    let input = SubmitBatchInput {
        rollup_id: "r".to_string(),
        batch_index: 2,
        state_root: vec![1; 32],
        prev_state_root: vec![2; 32],
        tx_count: 1,
        withdrawals_root: vec![7; 31],
        ..Default::default()
    };
    let err = tx
        .submit_batch(input.clone(), &TxOptions::default())
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("cannot submit batch 2") && err.contains("got 31"),
        "{err}"
    );
    assert!(!posted(&chain));

    let ok = SubmitBatchInput {
        withdrawals_root: vec![7; 32],
        ..input
    };
    tx.submit_batch(ok, &TxOptions::default()).unwrap();
    assert!(posted(&chain));
}

#[test]
fn stop_rollup_refuses_an_unsettled_latest_batch_under_in_order_settlement() {
    let chain = MockChain::new(true);
    let err = tx_client(chain.clone())
        .stop_rollup("r", None, &TxOptions::default())
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("cannot stop rollup \"r\"") && err.contains("submitted"),
        "{err}"
    );
    assert!(!posted(&chain));

    // Before the feature, the chain does not check it.
    let chain = MockChain::new(false);
    tx_client(chain.clone())
        .stop_rollup("r", None, &TxOptions::default())
        .unwrap();
    assert!(posted(&chain));
    let urls = chain.urls.lock().unwrap();
    assert!(!urls.iter().any(|u| u.contains("/latest_batch/")));
}
