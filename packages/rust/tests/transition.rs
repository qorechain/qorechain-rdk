//! Batch transition roots against vectors from the chain's own BatchTransitionRoot.

use std::sync::Arc;

use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::rest::RestClient;
use qorechain_rdk::client::views::{map_batch_view, BatchView};
use qorechain_rdk::transition::{
    batch_transition_root, batch_transition_root_v1, batch_transition_root_v2, fraud_proof,
    transition_root_version_for, transition_root_version_for_batch, TransitionInput,
    TransitionRootVersion,
};
use serde_json::Value;

fn golden() -> Value {
    serde_json::from_str(include_str!("golden.json")).unwrap()
}

fn h(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().unwrap()).unwrap()
}

#[test]
fn transition_roots_match_the_chain() {
    let g = golden();
    let t = &g["transitionRoot"];
    let input = TransitionInput {
        chain_id: t["chainId"].as_str().unwrap().into(),
        rollup_id: t["rollupId"].as_str().unwrap().into(),
        prev_state_root: h(&t["prevStateRoot"]),
        data_hash: h(&t["dataHash"]),
        tx_count: t["txCount"].as_u64().unwrap(),
        withdrawals_root: h(&t["withdrawalsRoot"]),
    };
    assert_eq!(
        hex::encode(batch_transition_root_v1(&input)),
        t["v1"].as_str().unwrap()
    );
    assert_eq!(
        hex::encode(batch_transition_root_v2(&input).unwrap()),
        t["v2"].as_str().unwrap()
    );
    let other = TransitionInput {
        chain_id: t["v2OtherChain"]["chainId"].as_str().unwrap().into(),
        ..input.clone()
    };
    assert_eq!(
        hex::encode(batch_transition_root(&other, TransitionRootVersion::V2).unwrap()),
        t["v2OtherChain"]["root"].as_str().unwrap()
    );
    let empty = TransitionInput {
        data_hash: vec![],
        withdrawals_root: vec![],
        tx_count: 1,
        ..input.clone()
    };
    assert_eq!(
        hex::encode(batch_transition_root_v1(&empty)),
        t["emptyBatch"]["v1"].as_str().unwrap()
    );
    assert_eq!(
        hex::encode(batch_transition_root_v2(&empty).unwrap()),
        t["emptyBatch"]["v2"].as_str().unwrap()
    );
    let no_chain = TransitionInput {
        chain_id: String::new(),
        ..input.clone()
    };
    assert!(batch_transition_root_v2(&no_chain).is_err());
    let bad = TransitionInput {
        withdrawals_root: vec![1, 2],
        ..input
    };
    assert!(batch_transition_root_v2(&bad)
        .unwrap_err()
        .contains("32 bytes"));
}

struct Fixed {
    feature_status: u16,
    enabled: bool,
    applied: &'static str,
}

impl Transport for Fixed {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        if request.url.contains("protocol_features") {
            if self.feature_status != 200 {
                return Ok(HttpResponse {
                    status: self.feature_status,
                    body: "{}".into(),
                });
            }
            return Ok(HttpResponse {
                status: 200,
                body: format!(
                    r#"{{"features":[{{"name":"rdk-withdrawals-binding","enabled":{}}}]}}"#,
                    self.enabled
                ),
            });
        }
        if request.url.ends_with("/applied_plan/v3.2.5") {
            return Ok(HttpResponse {
                status: 200,
                body: format!(r#"{{"height":"{}"}}"#, self.applied),
            });
        }
        Ok(HttpResponse {
            status: 404,
            body: "{}".into(),
        })
    }
}

fn rest(feature_status: u16, enabled: bool, applied: &'static str) -> RestClient {
    RestClient::with_transport(
        "http://node",
        Arc::new(Fixed {
            feature_status,
            enabled,
            applied,
        }),
    )
}

#[test]
fn version_follows_the_chain() {
    use TransitionRootVersion::*;
    assert_eq!(
        transition_root_version_for(&rest(200, true, "0")).unwrap(),
        V2
    );
    assert_eq!(
        transition_root_version_for(&rest(200, false, "0")).unwrap(),
        V1
    );
    assert_eq!(
        transition_root_version_for(&rest(501, false, "0")).unwrap(),
        V1
    );
    assert!(transition_root_version_for(&rest(500, false, "0")).is_err());

    let r = rest(200, true, "8890800");
    let at = |h: i64| -> BatchView { map_batch_view(&serde_json::json!({ "submitted_at": h })) };
    assert_eq!(
        transition_root_version_for_batch(&r, &at(8_890_800)).unwrap(),
        V2
    );
    assert_eq!(
        transition_root_version_for_batch(&r, &at(8_890_799)).unwrap(),
        V1
    );
    assert_eq!(
        transition_root_version_for_batch(&rest(200, false, "0"), &at(9_000_000)).unwrap(),
        V1
    );
    let flagged =
        map_batch_view(&serde_json::json!({ "submitted_at": 1, "withdrawals_bound": true }));
    assert_eq!(
        transition_root_version_for_batch(&rest(200, false, "0"), &flagged).unwrap(),
        V2
    );
}

#[test]
fn fraud_proof_layout() {
    let p = fraud_proof(&[0x11; 32], &[0x22; 32]).unwrap();
    assert_eq!(p, [[0x11u8; 32], [0x22u8; 32]].concat());
    assert!(fraud_proof(&[1], &[0x22; 32]).is_err());
}
