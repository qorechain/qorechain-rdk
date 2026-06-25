//! Integration tests for the read/broadcast clients (using a mock transport so
//! tests never touch the network) and a sign -> verify roundtrip.

use std::sync::{Arc, Mutex};

use serde_json::json;

use qorechain_rdk::accounts::NativeAccount;
use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Method, Transport};
use qorechain_rdk::client::{QorClient, RdkClient, RdkClientOptions, RestClient};
use qorechain_rdk::tx::messages::CreateRollupInput;
use qorechain_rdk::tx::{RdkTxClient, TxOptions};

const GOLDEN_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// A scripted transport: returns canned responses and records the requests it
/// receives.
struct MockTransport {
    response: Mutex<HttpResponse>,
    last: Mutex<Option<HttpRequest>>,
}

impl MockTransport {
    fn new(status: u16, body: &str) -> Arc<Self> {
        Arc::new(MockTransport {
            response: Mutex::new(HttpResponse {
                status,
                body: body.to_string(),
            }),
            last: Mutex::new(None),
        })
    }
}

impl Transport for MockTransport {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        *self.last.lock().unwrap() = Some(request);
        Ok(self.response.lock().unwrap().clone())
    }
}

#[test]
fn rest_client_maps_params() {
    let body = json!({
        "params": {
            "max_rollups": 100,
            "min_stake_for_rollup": "10000000000",
            "rollup_creation_burn_rate": "0.01",
            "default_challenge_window": 604800,
            "max_da_blob_size": 2097152,
            "blob_retention_blocks": 432000,
            "max_batches_per_block": 10
        }
    })
    .to_string();
    let transport = MockTransport::new(200, &body);
    let rest = RestClient::with_transport("http://node.example/", transport.clone());
    let params = rest.get_params().unwrap();
    assert_eq!(params.max_rollups, 100);
    assert_eq!(params.min_stake_for_rollup, "10000000000");
    assert_eq!(params.rollup_creation_burn_rate, "0.01");
    assert_eq!(params.default_challenge_window, 604800);

    let last = transport.last.lock().unwrap().clone().unwrap();
    assert_eq!(last.method, Method::Get);
    assert_eq!(last.url, "http://node.example/qorechain/rdk/v1/params");
}

#[test]
fn rest_client_maps_rollup() {
    let body = json!({
        "rollup": {
            "rollup_id": "my-rollup",
            "creator": "qor1creator",
            "profile": "defi",
            "settlement_mode": "zk",
            "da_backend": "native",
            "block_time_ms": 500,
            "max_tx_per_block": 10000,
            "vm_type": "evm",
            "status": "active",
            "stake_amount": "10000000000",
            "layer_id": "layer-1",
            "created_height": 42
        }
    })
    .to_string();
    let rest = RestClient::with_transport("http://node.example", MockTransport::new(200, &body));
    let rollup = rest.get_rollup("my-rollup").unwrap();
    assert_eq!(rollup.rollup_id, "my-rollup");
    assert_eq!(rollup.settlement_mode, "zk");
    assert_eq!(rollup.status, "active");
    assert_eq!(rollup.created_height, 42);
}

#[test]
fn jsonrpc_client_suggests_profile() {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "result": { "profile": "gaming" } }).to_string();
    let transport = MockTransport::new(200, &body);
    let qor = QorClient::with_transport("http://node.example:8545", transport.clone());
    let result = qor.suggest_rollup_profile("low-latency game").unwrap();
    assert_eq!(result["profile"].as_str(), Some("gaming"));

    let last = transport.last.lock().unwrap().clone().unwrap();
    assert_eq!(last.method, Method::Post);
    assert!(last.body.unwrap().contains("qor_suggestRollupProfile"));
}

#[test]
fn facade_suggests_profile_with_fallback() {
    // Advisory path.
    let body = json!({ "jsonrpc": "2.0", "id": 1, "result": "nft" }).to_string();
    let client = RdkClient::new(RdkClientOptions {
        transport: Some(MockTransport::new(200, &body)),
        ..Default::default()
    });
    let s = client.suggest_profile("digital collectibles", None);
    assert_eq!(s.profile, qorechain_rdk::Profile::Nft);

    // Fallback path on an RPC error.
    let err_body = json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": -1, "message": "down" } })
        .to_string();
    let client = RdkClient::new(RdkClientOptions {
        transport: Some(MockTransport::new(200, &err_body)),
        ..Default::default()
    });
    let s = client.suggest_profile("anything", None);
    assert_eq!(s.profile, qorechain_rdk::Profile::Defi);
}

#[test]
fn tx_client_signs_and_broadcasts_via_mock() {
    // A canned broadcast response.
    let body = json!({ "tx_response": { "code": 0, "txhash": "ABCD" } }).to_string();
    let transport = MockTransport::new(200, &body);
    let rest = RestClient::with_transport("http://node.example", transport.clone());
    let account = NativeAccount::from_mnemonic_default(GOLDEN_MNEMONIC).unwrap();
    let addr = account.address().to_string();
    let tx = RdkTxClient::new(account, rest, "qorechain-diana", 0, 0);

    let resp = tx
        .create_rollup(
            "my-rollup",
            "defi",
            "evm",
            10_000_000_000,
            &TxOptions::default(),
        )
        .unwrap();
    assert_eq!(resp["tx_response"]["code"].as_i64(), Some(0));

    // The broadcast posted a base64 tx to the Cosmos tx endpoint.
    let last = transport.last.lock().unwrap().clone().unwrap();
    assert_eq!(last.method, Method::Post);
    assert_eq!(last.url, "http://node.example/cosmos/tx/v1beta1/txs");
    let sent = last.body.unwrap();
    assert!(sent.contains("BROADCAST_MODE_SYNC"));
    assert!(sent.contains("tx_bytes"));
    assert_eq!(addr, "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h");
}

#[test]
fn sign_doc_roundtrip_verifies() {
    use cosmrs::crypto::secp256k1::SigningKey;

    let account = NativeAccount::from_mnemonic_default(GOLDEN_MNEMONIC).unwrap();
    let key: &SigningKey = account.signing_key();
    let public = key.public_key();

    // Sign a representative payload and verify with the public key.
    let create = CreateRollupInput {
        creator: account.address().to_string(),
        rollup_id: "r".to_string(),
        profile: "defi".to_string(),
        vm_type: "evm".to_string(),
        stake_amount: 1,
    };
    let payload = qorechain_rdk::tx::codecs::RdkMsg::encode_to_vec_msg(&create.to_msg());
    let signature = key.sign(&payload).unwrap();

    // The compressed SEC1 public-key bytes, recovered from the cosmrs PublicKey.
    let sec1 = public.to_bytes();
    assert!(k256_verify(&sec1, &payload, &signature.to_vec()));

    // A tampered message must NOT verify.
    let mut bad = payload.clone();
    bad.push(0xff);
    assert!(!k256_verify(&sec1, &bad, &signature.to_vec()));
}

/// Verify a secp256k1 signature using the compressed SEC1 public key bytes.
fn k256_verify(pubkey_sec1: &[u8], msg: &[u8], sig: &[u8]) -> bool {
    use k256::ecdsa::signature::Verifier;
    use k256::ecdsa::{Signature, VerifyingKey};
    let vk = match VerifyingKey::from_sec1_bytes(pubkey_sec1) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let signature = match Signature::from_slice(sig) {
        Ok(s) => s,
        Err(_) => return false,
    };
    vk.verify(msg, &signature).is_ok()
}
