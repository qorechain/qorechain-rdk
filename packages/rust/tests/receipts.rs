//! Integration tests for the quantum-safe settlement receipts and the QCAI
//! rollup copilot, plus the cross-implementation ML-DSA-87 golden vector. Uses a
//! path-routing mock transport so tests never touch the network.

use std::sync::{Arc, Mutex};

use serde_json::Value;

use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::{RdkClient, RdkClientOptions};
use qorechain_rdk::receipts::{
    anchor_sign_bytes, build_settlement_receipt, verify_settlement_receipt,
    ReceiptVerificationMode, SettlementReceipt,
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

/// Base64, the encoding the REST surface uses for proto `bytes` fields.
fn b64(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    STANDARD.encode(bytes)
}

fn b64_hex(hexstr: &str) -> String {
    b64(&hex::decode(hexstr).unwrap())
}

/// A mock chain holding rollup `my-rollup` on the golden layer, its batch 0, the
/// anchor covering that batch, and the creator's registered ML-DSA-87 key.
struct ChainFixture {
    client: RdkClient,
    public_key: Vec<u8>,
    signature: Vec<u8>,
    layer_id: String,
    state_root_hex: String,
    vsh_hex: String,
    layer_height: u64,
}

const CREATOR: &str = "qor1creator";

/// Stand up the mock chain. When `tamper_signature` is set, the anchor the chain
/// publishes carries a corrupted signature, so the receipt built from it cannot
/// verify against the creator's registered key.
fn chain_fixture(tamper_signature: bool) -> ChainFixture {
    let g = golden();
    let asb = &g["anchorSignBytes"];
    let layer_id = asb["layerId"].as_str().unwrap().to_string();
    let layer_height = asb["layerHeight"].as_u64().unwrap();
    let state_root_hex = asb["stateRoot"].as_str().unwrap().to_string();
    let vsh_hex = asb["validatorSetHash"].as_str().unwrap().to_string();

    let (pk, sk) = qorechain_pqc::mldsa::ml_dsa_87::keygen().unwrap();
    let message = anchor_sign_bytes(&layer_id, layer_height, &state_root_hex, &vsh_hex);
    let mut sig = qorechain_pqc::mldsa::ml_dsa_87::sign(&sk, &message).unwrap();
    if tamper_signature {
        sig[10] ^= 0xff;
    }

    let routes = vec![
        (
            "/qorechain/rdk/v1/rollup/",
            serde_json::json!({
                "rollup": {
                    "rollup_id": "my-rollup",
                    "creator": CREATOR,
                    "layer_id": layer_id,
                    "status": "active"
                }
            }),
        ),
        (
            "/qorechain/rdk/v1/batch/",
            serde_json::json!({
                "batch": { "batch_index": 0, "state_root": b64_hex(&state_root_hex) }
            }),
        ),
        (
            "/qorechain/multilayer/v1/anchors/",
            serde_json::json!({
                "anchors": [
                    {
                        "layer_id": layer_id,
                        "layer_height": layer_height,
                        "state_root": b64_hex(&state_root_hex),
                        "validator_set_hash": b64_hex(&vsh_hex),
                        "main_chain_height": 1000,
                        "anchored_at": 1_700_000_000,
                        "pqc_aggregate_signature": b64(&sig),
                        "transaction_count": 3
                    }
                ]
            }),
        ),
        (
            "/qorechain/pqc/v1/accounts/",
            serde_json::json!({
                "account": {
                    "address": CREATOR,
                    "public_key": b64(&pk),
                    "algorithm_id": 3,
                    "algorithm_name": "ML-DSA-87"
                }
            }),
        ),
    ];

    ChainFixture {
        client: RdkClient::new(RdkClientOptions {
            transport: Some(RoutingTransport::new(routes)),
            ..Default::default()
        }),
        public_key: pk,
        signature: sig,
        layer_id,
        state_root_hex,
        vsh_hex,
        layer_height,
    }
}

#[test]
fn build_and_verify_settlement_receipt_round_trip() {
    let f = chain_fixture(false);

    let receipt = build_settlement_receipt(&f.client, "my-rollup", 0).expect("receipt builds");
    assert_eq!(receipt.layer_id, f.layer_id);
    assert_eq!(receipt.state_root, f.state_root_hex);
    assert_eq!(receipt.batch_state_root, f.state_root_hex);
    assert_eq!(receipt.validator_set_hash, f.vsh_hex);
    assert_eq!(receipt.layer_height, f.layer_height);
    assert_eq!(receipt.creator, CREATOR);
    assert_eq!(receipt.pqc_signature, hex::encode(&f.signature));

    // Only a verification against live chain state can be valid.
    let v = verify_settlement_receipt(&receipt, None, Some(&f.client));
    assert!(v.valid, "receipt should verify: {:?}", v.reason);
    assert_eq!(v.mode, ReceiptVerificationMode::Chain);
    assert!(v.checks.rollup_layer_binding);
    assert!(v.checks.batch_state_root);
    assert!(v.checks.anchor_on_chain);
    assert!(v.checks.creator_authority);
    assert!(v.checks.pqc_signature);
    assert!(v.reason.is_none());

    // JSON round-trip of the receipt.
    let json = serde_json::to_string(&receipt).unwrap();
    let back: SettlementReceipt = serde_json::from_str(&json).unwrap();
    assert_eq!(back, receipt);
}

#[test]
fn signature_only_is_never_valid_even_for_a_genuine_receipt() {
    let f = chain_fixture(false);
    let receipt = build_settlement_receipt(&f.client, "my-rollup", 0).expect("receipt builds");

    let v = verify_settlement_receipt(&receipt, Some(&hex::encode(&f.public_key)), None);
    // The signature really is good...
    assert!(v.checks.pqc_signature);
    // ...but nothing was checked against the chain.
    assert!(!v.valid);
    assert_eq!(v.mode, ReceiptVerificationMode::SignatureOnly);
    assert!(v.reason.unwrap().contains("chain"));
}

#[test]
fn verify_refuses_without_a_client() {
    let f = chain_fixture(false);
    let receipt = build_settlement_receipt(&f.client, "my-rollup", 0).expect("receipt builds");

    let v = verify_settlement_receipt(&receipt, None, None);
    assert!(!v.valid);
    assert_eq!(v.mode, ReceiptVerificationMode::SignatureOnly);
    assert!(!v.checks.pqc_signature);
    assert!(v.reason.unwrap().contains("client"));
}

#[test]
fn verify_settlement_receipt_detects_tamper() {
    // The chain publishes an anchor whose signature has been corrupted.
    let f = chain_fixture(true);
    let receipt = build_settlement_receipt(&f.client, "my-rollup", 0).expect("receipt builds");

    let v = verify_settlement_receipt(&receipt, None, Some(&f.client));
    assert!(!v.valid);
    assert_eq!(v.mode, ReceiptVerificationMode::Chain);
    // Everything up to the signature reproduces from chain state.
    assert!(v.checks.rollup_layer_binding);
    assert!(v.checks.batch_state_root);
    assert!(v.checks.anchor_on_chain);
    assert!(v.checks.creator_authority);
    assert!(!v.checks.pqc_signature);

    // A receipt whose signature was swapped out no longer matches any anchor.
    let mut swapped = receipt.clone();
    swapped.pqc_signature = "00".repeat(receipt.pqc_signature.len() / 2);
    let v2 = verify_settlement_receipt(&swapped, None, Some(&f.client));
    assert!(!v2.valid);
    assert!(!v2.checks.anchor_on_chain);
}

/// QSR-2026-0055 regression: a receipt is a claim, not evidence. An attacker
/// generates their own ML-DSA-87 keypair, invents a state root, makes both
/// state-root fields agree (defeating the old vacuous "binding" check) and signs
/// the canonical anchor bytes. It must never verify.
#[test]
fn rejects_fabricated_receipt_qsr_2026_0055() {
    let (evil_pk, evil_sk) = qorechain_pqc::mldsa::ml_dsa_87::keygen().unwrap();

    let layer_id = "layer-victim";
    let layer_height = 123_456u64;
    let state_root = "de".repeat(32);
    let vsh = "ab".repeat(32);

    let mut fake = SettlementReceipt {
        version: 1,
        rollup_id: "victim-rollup".to_string(),
        layer_id: layer_id.to_string(),
        batch_index: 999,
        creator: "qor1attackerownaddress".to_string(),
        algorithm: "ML-DSA-87".to_string(),
        state_root: state_root.clone(),
        layer_height,
        validator_set_hash: vsh.clone(),
        main_chain_height: 999_999,
        anchored_at: 1_757_000_000,
        pqc_signature: String::new(),
        // The attacker controls both sides of the old "binding" check.
        batch_state_root: state_root.clone(),
    };
    let message = anchor_sign_bytes(layer_id, layer_height, &state_root, &vsh);
    fake.pqc_signature =
        hex::encode(qorechain_pqc::mldsa::ml_dsa_87::sign(&evil_sk, &message).unwrap());
    assert_eq!(fake.state_root, fake.batch_state_root);

    // Signature-only: internally consistent, and still worthless as proof.
    let sig_only = verify_settlement_receipt(&fake, Some(&hex::encode(&evil_pk)), None);
    assert!(sig_only.checks.pqc_signature);
    assert!(!sig_only.valid, "a self-signed receipt must never be valid");
    assert_eq!(sig_only.mode, ReceiptVerificationMode::SignatureOnly);

    // Against the chain: no such rollup/layer exists, so it cannot pass.
    let f = chain_fixture(false);
    let v = verify_settlement_receipt(&fake, Some(&hex::encode(&evil_pk)), Some(&f.client));
    assert!(!v.valid);
    assert_eq!(v.mode, ReceiptVerificationMode::Chain);
    assert!(!v.checks.rollup_layer_binding);
    assert!(!v.checks.anchor_on_chain);
    assert!(!v.checks.pqc_signature);
}

#[test]
fn build_receipt_errors_when_no_anchor_covers_batch() {
    let g = golden();
    let asb = &g["anchorSignBytes"];
    let layer_id = asb["layerId"].as_str().unwrap();
    let state_root_hex = asb["stateRoot"].as_str().unwrap();

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
            serde_json::json!({ "batch": { "batch_index": 0, "state_root": b64_hex(state_root_hex) } }),
        ),
        (
            "/qorechain/multilayer/v1/anchors/",
            serde_json::json!({
                "anchors": [
                    { "layer_id": layer_id, "layer_height": 7, "state_root": b64_hex(&other_root) }
                ]
            }),
        ),
        (
            "/qorechain/multilayer/v1/anchor/",
            serde_json::json!({
                "anchor": { "layer_id": layer_id, "layer_height": 7, "state_root": b64_hex(&other_root) }
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
