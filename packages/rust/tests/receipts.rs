//! Integration tests for the quantum-safe settlement receipts and the QCAI
//! rollup copilot, plus the cross-implementation ML-DSA-87 golden vector. Uses a
//! path-routing mock transport so tests never touch the network.

use std::sync::{Arc, Mutex};

use serde_json::Value;

use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::{RdkClient, RdkClientOptions};
use qorechain_rdk::receipts::{
    anchor_sign_bytes, build_settlement_receipt, verify_settlement_receipt, SettlementReceipt,
};

fn golden() -> Value {
    let raw = include_str!("golden.json");
    serde_json::from_str(raw).expect("golden.json parses")
}

/// A transport that answers based on the request path. Each route returns a
/// canned JSON body; unmatched routes return `404`.
struct RoutingTransport {
    routes: Vec<(String, String)>,
    requests: Arc<Mutex<Vec<String>>>,
}

impl RoutingTransport {
    fn new(routes: Vec<(&str, Value)>) -> Arc<Self> {
        Arc::new(RoutingTransport {
            routes: routes
                .into_iter()
                .map(|(p, v)| (p.to_string(), v.to_string()))
                .collect(),
            requests: Arc::new(Mutex::new(Vec::new())),
        })
    }
}

impl Transport for RoutingTransport {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        self.requests.lock().unwrap().push(request.url.clone());
        for (needle, body) in &self.routes {
            if request.url.contains(needle.as_str()) {
                return Ok(HttpResponse {
                    status: 200,
                    body: body.clone(),
                });
            }
        }
        Ok(HttpResponse {
            status: 404,
            body: "{}".to_string(),
        })
    }
}

#[test]
fn anchor_sign_bytes_matches_golden() {
    let g = golden();
    let v = &g["anchorSignBytes"];
    let bytes = anchor_sign_bytes(
        v["layerId"].as_str().unwrap(),
        v["layerHeight"].as_u64().unwrap(),
        v["stateRoot"].as_str().unwrap(),
        v["validatorSetHash"].as_str().unwrap(),
    );
    assert_eq!(hex::encode(&bytes), v["expectedHex"].as_str().unwrap());
}

#[test]
fn mldsa87_cross_impl_vector_verifies() {
    let g = golden();
    let v = &g["mldsaVector"];
    let public_key = hex::decode(v["publicKeyHex"].as_str().unwrap()).unwrap();
    let message = v["messageUtf8"].as_str().unwrap().as_bytes();
    let signature = hex::decode(v["signatureHex"].as_str().unwrap()).unwrap();
    assert!(qorechain_pqc::mldsa::ml_dsa_87::verify(
        &public_key,
        message,
        &signature
    ));

    // A tampered message must NOT verify.
    let mut bad = message.to_vec();
    bad.push(0xff);
    assert!(!qorechain_pqc::mldsa::ml_dsa_87::verify(
        &public_key,
        &bad,
        &signature
    ));
}

/// Build a self-consistent receipt over the golden `anchorSignBytes` message,
/// signed with a fresh ML-DSA-87 keypair (the cross-impl golden vector is
/// asserted separately in `mldsa87_cross_impl_vector_verifies`). Returns the
/// receipt and the matching public key (hex).
fn receipt_fixture() -> (SettlementReceipt, String) {
    let g = golden();
    let asb = &g["anchorSignBytes"];

    let layer_id = asb["layerId"].as_str().unwrap();
    let layer_height = asb["layerHeight"].as_u64().unwrap();
    let state_root_hex = asb["stateRoot"].as_str().unwrap();
    let vsh_hex = asb["validatorSetHash"].as_str().unwrap();

    let (pk, sk) = qorechain_pqc::mldsa::ml_dsa_87::keygen().unwrap();
    let message = anchor_sign_bytes(layer_id, layer_height, state_root_hex, vsh_hex);
    let sig = qorechain_pqc::mldsa::ml_dsa_87::sign(&sk, &message).unwrap();

    let receipt = SettlementReceipt {
        version: 1,
        rollup_id: "my-rollup".to_string(),
        layer_id: layer_id.to_string(),
        batch_index: 0,
        creator: "qor1creator".to_string(),
        algorithm: "ML-DSA-87".to_string(),
        state_root: state_root_hex.to_string(),
        layer_height,
        validator_set_hash: vsh_hex.to_string(),
        main_chain_height: 1000,
        anchored_at: 1_700_000_000,
        pqc_signature: hex::encode(&sig),
        batch_state_root: state_root_hex.to_string(),
    };
    (receipt, hex::encode(&pk))
}

#[test]
fn build_and_verify_settlement_receipt_round_trip() {
    let g = golden();
    let asb = &g["anchorSignBytes"];
    let layer_id = asb["layerId"].as_str().unwrap();
    let state_root_hex = asb["stateRoot"].as_str().unwrap();
    let vsh_hex = asb["validatorSetHash"].as_str().unwrap();
    let layer_height = asb["layerHeight"].as_u64().unwrap();

    // Sign the canonical anchor bytes with a fresh ML-DSA-87 key.
    let (pk, sk) = qorechain_pqc::mldsa::ml_dsa_87::keygen().unwrap();
    let message = anchor_sign_bytes(layer_id, layer_height, state_root_hex, vsh_hex);
    let sig = qorechain_pqc::mldsa::ml_dsa_87::sign(&sk, &message).unwrap();
    let creator = "qor1creator";

    // The anchor REST surface encodes proto `bytes` as base64.
    let b64 = |hexstr: &str| {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine as _;
        STANDARD.encode(hex::decode(hexstr).unwrap())
    };

    let routes = vec![
        (
            "/qorechain/rdk/v1/rollup/",
            serde_json::json!({
                "rollup": {
                    "rollup_id": "my-rollup",
                    "creator": creator,
                    "layer_id": layer_id,
                    "status": "active"
                }
            }),
        ),
        (
            "/qorechain/rdk/v1/batch/",
            serde_json::json!({
                "batch": { "batch_index": 0, "state_root": b64(state_root_hex) }
            }),
        ),
        (
            "/qorechain/multilayer/v1/anchors/",
            serde_json::json!({
                "anchors": [
                    {
                        "layer_id": layer_id,
                        "layer_height": layer_height,
                        "state_root": b64(state_root_hex),
                        "validator_set_hash": b64(vsh_hex),
                        "main_chain_height": 1000,
                        "anchored_at": 1_700_000_000,
                        "pqc_aggregate_signature": b64(&hex::encode(&sig)),
                        "transaction_count": 3
                    }
                ]
            }),
        ),
        (
            "/qorechain/pqc/v1/accounts/",
            serde_json::json!({
                "account": {
                    "address": creator,
                    "public_key": b64(&hex::encode(&pk)),
                    "algorithm_id": 3,
                    "algorithm_name": "ML-DSA-87"
                }
            }),
        ),
    ];

    let transport = RoutingTransport::new(routes);
    let client = RdkClient::new(RdkClientOptions {
        transport: Some(transport),
        ..Default::default()
    });

    let receipt = build_settlement_receipt(&client, "my-rollup", 0).expect("receipt builds");
    assert_eq!(receipt.layer_id, layer_id);
    assert_eq!(receipt.state_root, state_root_hex);
    assert_eq!(receipt.batch_state_root, state_root_hex);
    assert_eq!(receipt.validator_set_hash, vsh_hex);
    assert_eq!(receipt.creator, creator);
    assert_eq!(receipt.pqc_signature, hex::encode(&sig));

    // Verify with the key fetched via the client.
    let v = verify_settlement_receipt(&receipt, None, Some(&client));
    assert!(v.valid, "receipt should verify: {:?}", v.reason);
    assert!(v.checks.state_root_binding);
    assert!(v.checks.pqc_signature);
    assert!(v.checks.has_material);

    // Verify offline with the supplied public key.
    let v2 = verify_settlement_receipt(&receipt, Some(&hex::encode(&pk)), None);
    assert!(v2.valid);

    // JSON round-trip of the receipt.
    let json = serde_json::to_string(&receipt).unwrap();
    let back: SettlementReceipt = serde_json::from_str(&json).unwrap();
    assert_eq!(back, receipt);
}

#[test]
fn verify_settlement_receipt_detects_tamper() {
    let (mut receipt, pk_hex) = receipt_fixture();

    // Sanity: the untampered receipt verifies offline.
    let ok = verify_settlement_receipt(&receipt, Some(&pk_hex), None);
    assert!(ok.valid);

    // Tamper the batch state root -> binding fails.
    let mut tampered = receipt.clone();
    tampered.batch_state_root = "00".repeat(32);
    let bad = verify_settlement_receipt(&tampered, Some(&pk_hex), None);
    assert!(!bad.valid);
    assert!(!bad.checks.state_root_binding);

    // Tamper the signature -> signature check fails.
    receipt.pqc_signature = "00".repeat(receipt.pqc_signature.len() / 2);
    let bad_sig = verify_settlement_receipt(&receipt, Some(&pk_hex), None);
    assert!(!bad_sig.valid);
    assert!(!bad_sig.checks.pqc_signature);
}

#[test]
fn build_receipt_errors_when_no_anchor_covers_batch() {
    let g = golden();
    let asb = &g["anchorSignBytes"];
    let layer_id = asb["layerId"].as_str().unwrap();
    let state_root_hex = asb["stateRoot"].as_str().unwrap();

    let b64 = |hexstr: &str| {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine as _;
        STANDARD.encode(hex::decode(hexstr).unwrap())
    };

    // The single anchor commits a *different* state root than the batch.
    let other_root = "11".repeat(32);
    let routes = vec![
        (
            "/qorechain/rdk/v1/rollup/",
            serde_json::json!({
                "rollup": { "rollup_id": "my-rollup", "creator": "qor1creator", "layer_id": layer_id }
            }),
        ),
        (
            "/qorechain/rdk/v1/batch/",
            serde_json::json!({ "batch": { "batch_index": 0, "state_root": b64(state_root_hex) } }),
        ),
        (
            "/qorechain/multilayer/v1/anchors/",
            serde_json::json!({
                "anchors": [
                    { "layer_id": layer_id, "layer_height": 7, "state_root": b64(&other_root) }
                ]
            }),
        ),
        (
            "/qorechain/multilayer/v1/anchor/",
            serde_json::json!({
                "anchor": { "layer_id": layer_id, "layer_height": 7, "state_root": b64(&other_root) }
            }),
        ),
    ];

    let client = RdkClient::new(RdkClientOptions {
        transport: Some(RoutingTransport::new(routes)),
        ..Default::default()
    });
    let err = build_settlement_receipt(&client, "my-rollup", 0).unwrap_err();
    assert!(matches!(
        err,
        qorechain_rdk::receipts::ReceiptError::NotAnchored { .. }
    ));
}

#[test]
fn rollup_advice_aggregates_and_degrades() {
    let layer_id = "layer-rollup-1";
    // fee-estimate and network-recs present; fraud references the rollup; RL up.
    let routes = vec![
        (
            "/qorechain/rdk/v1/rollup/",
            serde_json::json!({
                "rollup": { "rollup_id": "my-rollup", "creator": "qor1creator", "layer_id": layer_id, "status": "paused" }
            }),
        ),
        (
            "/qorechain/ai/v1/fee-estimate",
            serde_json::json!({ "uqor": "1200", "urgency": "normal" }),
        ),
        (
            "/qorechain/ai/v1/network/recommendations",
            serde_json::json!({ "note": "network is congested right now" }),
        ),
        (
            "/qorechain/ai/v1/fraud/investigations",
            serde_json::json!({
                "investigations": [
                    { "id": "f1", "subject": "rollup my-rollup batch 4" },
                    { "id": "f2", "subject": "some-other-rollup" }
                ]
            }),
        ),
        // RL agent is a JSON-RPC POST; the EVM RPC url has no path we match, so
        // it falls through to 404 -> a warning, exercising the degrade path.
    ];

    let client = RdkClient::new(RdkClientOptions {
        transport: Some(RoutingTransport::new(routes)),
        ..Default::default()
    });
    let advice = qorechain_rdk::copilot::get_rollup_advice(&client, "my-rollup");

    assert_eq!(advice.rollup_id, "my-rollup");
    assert_eq!(advice.status, "paused");
    assert!(advice.fee_estimate.is_some());
    assert!(advice.network_recommendations.is_some());
    // Only the investigation that mentions the rollup is kept.
    assert_eq!(advice.fraud_investigations.len(), 1);

    let msgs: Vec<&str> = advice.suggestions.iter().map(|s| s.message.as_str()).collect();
    assert!(msgs.iter().any(|m| m.contains("status is \"paused\"")));
    assert!(msgs.iter().any(|m| m.contains("fraud investigation")));
    assert!(msgs.iter().any(|m| m.contains("congestion")));

    // The RL agent surface was unreachable -> recorded as a warning, not fatal.
    assert!(advice.rl_agent_status.is_none());
    assert!(advice.warnings.iter().any(|w| w.starts_with("rl-agent-status")));
}
