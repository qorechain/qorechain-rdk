//! Hybrid (post-quantum) signing: the golden `hybridTx` vectors the TypeScript
//! SDK built, key resolution against a mock REST transport, the sign-bytes
//! resolver, and the unchanged classical path.

use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use prost::Message as _;
use serde_json::{json, Value};

use qorechain_rdk::accounts::{
    derive_pqc_canonical, derive_pqc_legacy, pqc_keypair_from_env_with, pqc_keypair_from_seed,
    resolve_pqc_keypair, NativeAccount, PqcDerivation,
};
use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Method, Transport};
use qorechain_rdk::client::{RdkClient, RdkClientOptions, RestClient};
use qorechain_rdk::tx::messages::PauseRollupInput;
use qorechain_rdk::tx::{
    HybridSigningOptions, MsgPauseRollup, RdkTxClient, SignBytesMode, SignBytesVersion, TxError,
    TxOptions,
};

fn golden() -> Value {
    serde_json::from_str(include_str!("golden.json")).expect("golden.json parses")
}

/// Canned answers (status, body) for requests whose URL contains a fragment.
type Route = (String, Vec<(u16, String)>);

/// A transport that answers by URL substring and records every request. An
/// unmatched request is a 404.
#[derive(Default)]
struct Routes {
    routes: Mutex<Vec<Route>>,
    requests: Mutex<Vec<HttpRequest>>,
}

impl Routes {
    fn new() -> Arc<Self> {
        Arc::new(Routes::default())
    }

    /// Answer requests whose URL contains `fragment`; several answers are
    /// served in order, the last one repeating.
    fn on(self: &Arc<Self>, fragment: &str, answers: &[(u16, Value)]) -> Arc<Self> {
        self.routes.lock().unwrap().push((
            fragment.to_string(),
            answers.iter().map(|(s, b)| (*s, b.to_string())).collect(),
        ));
        self.clone()
    }

    fn requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().unwrap().clone()
    }

    fn count(&self, fragment: &str) -> usize {
        self.requests()
            .iter()
            .filter(|r| r.url.contains(fragment))
            .count()
    }
}

impl Transport for Routes {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        self.requests.lock().unwrap().push(request.clone());
        let mut routes = self.routes.lock().unwrap();
        for (fragment, answers) in routes.iter_mut() {
            if request.url.contains(fragment.as_str()) {
                let (status, body) = if answers.len() > 1 {
                    answers.remove(0)
                } else {
                    answers[0].clone()
                };
                return Ok(HttpResponse { status, body });
            }
        }
        Ok(HttpResponse {
            status: 404,
            body: json!({ "code": 5, "message": "not found" }).to_string(),
        })
    }
}

struct Vector {
    mnemonic: String,
    address: String,
    msg: MsgPauseRollup,
    opts: TxOptions,
    chain_id: String,
    account_number: u64,
    sequence: u64,
}

fn vector() -> Vector {
    let g = golden();
    let h = &g["hybridTx"];
    let m = &h["message"];
    assert_eq!(m["typeUrl"], "/qorechain.rdk.v1.MsgPauseRollup");
    assert_eq!(h["fee"]["amount"][0]["denom"], "uqor");
    let msg = PauseRollupInput {
        creator: m["creator"].as_str().unwrap().to_string(),
        rollup_id: m["rollupId"].as_str().unwrap().to_string(),
        reason: m["reason"].as_str().unwrap().to_string(),
    }
    .to_msg();
    Vector {
        mnemonic: g["mnemonic"].as_str().unwrap().to_string(),
        address: g["nativeAddress"].as_str().unwrap().to_string(),
        msg,
        opts: TxOptions {
            gas_limit: h["fee"]["gas"].as_str().unwrap().parse().unwrap(),
            fee_amount_uqor: h["fee"]["amount"][0]["amount"]
                .as_str()
                .unwrap()
                .parse()
                .unwrap(),
            memo: h["memo"].as_str().unwrap().to_string(),
        },
        chain_id: h["chainId"].as_str().unwrap().to_string(),
        account_number: h["accountNumber"].as_u64().unwrap(),
        sequence: h["sequence"].as_u64().unwrap(),
    }
}

fn hybrid_client(
    v: &Vector,
    rest: RestClient,
    mode: SignBytesMode,
    include_pqc_public_key: bool,
) -> RdkTxClient<NativeAccount> {
    let account = NativeAccount::from_mnemonic_default(&v.mnemonic).unwrap();
    assert_eq!(account.address(), v.address);
    RdkTxClient::new_with_options(
        account,
        rest,
        v.chain_id.clone(),
        v.account_number,
        v.sequence,
        HybridSigningOptions {
            pqc_keypair: Some(derive_pqc_canonical(&v.address, &v.mnemonic)),
            sign_bytes_version: mode,
            include_pqc_public_key,
        },
    )
    .unwrap()
}

/// Says which part of two `TxRaw`s differs, for a readable failure.
fn tx_raw_diff(ours: &[u8], want: &[u8]) -> String {
    use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
    let a = TxRaw::decode(ours).expect("our TxRaw decodes");
    let b = TxRaw::decode(want).expect("golden TxRaw decodes");
    let mut parts = Vec::new();
    if a.auth_info_bytes != b.auth_info_bytes {
        parts.push("authInfo");
    }
    if a.signatures != b.signatures {
        parts.push("classical signature");
    }
    if a.body_bytes != b.body_bytes {
        let ab = TxBody::decode(a.body_bytes.as_slice()).unwrap();
        let bb = TxBody::decode(b.body_bytes.as_slice()).unwrap();
        if ab.messages != bb.messages || ab.memo != bb.memo {
            parts.push("body messages/memo");
        }
        if ab.extension_options != bb.extension_options {
            parts.push("extension (PQC signature)");
        }
    }
    format!("differs in: {}", parts.join(", "))
}

fn assert_golden_case(case: &str, mode: SignBytesMode, include_key: bool) {
    let g = golden();
    let want = &g["hybridTx"][case];
    let want_tx = hex::decode(want["txRawHex"].as_str().unwrap()).unwrap();
    let want_msg = want["pqcSignedMessageHex"].as_str().unwrap();

    // A fixed form must never touch the network.
    let routes = Routes::new();
    let v = vector();
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        mode,
        include_key,
    );
    let version = mode.fixed().unwrap();
    let built = tx.build_hybrid_tx(&v.msg, &v.opts, version).unwrap();

    assert_eq!(
        hex::encode(&built.pqc_signed_message),
        want_msg,
        "{case}: PQC signed message"
    );
    assert!(
        built.tx_raw_bytes == want_tx,
        "{case}: txRaw {}",
        tx_raw_diff(&built.tx_raw_bytes, &want_tx)
    );
    assert_eq!(built.sign_bytes_version, Some(version));

    // The broadcastable form is the same bytes.
    let b64 = tx.build_signed_tx(&v.msg, &v.opts).unwrap();
    assert_eq!(
        BASE64.decode(b64).unwrap(),
        want_tx,
        "{case}: build_signed_tx"
    );
    assert!(routes.requests().is_empty(), "{case}: no network call");
}

#[test]
fn golden_hybrid_v1() {
    assert_golden_case("v1", SignBytesMode::V1, false);
}

#[test]
fn golden_hybrid_v1_with_key() {
    assert_golden_case("v1WithKey", SignBytesMode::V1, true);
}

#[test]
fn golden_hybrid_v2() {
    assert_golden_case("v2", SignBytesMode::V2, false);
}

#[test]
fn golden_hybrid_v2_with_key() {
    assert_golden_case("v2WithKey", SignBytesMode::V2, true);
}

/// The classical tx this client built before hybrid signing existed, for the
/// golden input (fee 30000uqor / gas 200000, memo "rdk", account 7, sequence 3).
const CLASSICAL_TX_B64: &str = "CmUKXgogL3FvcmVjaGFpbi5yZGsudjEuTXNnUGF1c2VSb2xsdXASOgoqcW9yMTlybDRjbTJobXI4YWZ5NGtsZHB4ejNma2E0amd1cTBhZ3Q2NzJoEgxyb2xsLXZlY3RvcnMSA3JkaxJnClAKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiECT04q2Zw01gubpig8lDGoQYr4ZzISlh+Xp3tjd/zQW2ISBAoCCAEYAxITCg0KBHVxb3ISBTMwMDAwEMCaDBpA3wqDy+no8Zznx7r9yn+COGuen5xuAPHyBYb1ayAf2S8D/vdSeBbvRl81KafLCy6EojHvOYP+jOB/EmuCd4KEqQ==";

#[test]
fn classical_client_builds_the_same_tx_as_before() {
    let v = vector();
    let routes = Routes::new();
    let rest = RestClient::with_transport("http://node.example", routes.clone());
    let account = NativeAccount::from_mnemonic_default(&v.mnemonic).unwrap();
    let tx = RdkTxClient::new(account, rest, v.chain_id.clone(), 7, 3);
    assert!(!tx.is_hybrid());
    assert_eq!(
        tx.build_signed_tx(&v.msg, &v.opts).unwrap(),
        CLASSICAL_TX_B64
    );

    // Options without a keypair leave the client classical.
    let account = NativeAccount::from_mnemonic_default(&v.mnemonic).unwrap();
    let rest = RestClient::with_transport("http://node.example", routes.clone());
    let tx = RdkTxClient::new_with_options(
        account,
        rest,
        v.chain_id.clone(),
        7,
        3,
        HybridSigningOptions::default(),
    )
    .unwrap();
    assert!(!tx.is_hybrid());
    assert_eq!(
        tx.build_signed_tx(&v.msg, &v.opts).unwrap(),
        CLASSICAL_TX_B64
    );
    assert!(matches!(
        tx.build_hybrid_tx(&v.msg, &v.opts, SignBytesVersion::V1),
        Err(TxError::Build(_))
    ));
    assert!(routes.requests().is_empty());
}

#[test]
fn hybrid_matches_the_classical_body_and_auth_info() {
    use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
    let v = vector();
    let classical = TxRaw::decode(BASE64.decode(CLASSICAL_TX_B64).unwrap().as_slice()).unwrap();
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", Routes::new()),
        SignBytesMode::V2,
        false,
    );
    let built = tx
        .build_hybrid_tx(&v.msg, &v.opts, SignBytesVersion::V2)
        .unwrap();
    // Same signer info, fee and sequence; same messages and memo.
    assert_eq!(built.auth_info_bytes, classical.auth_info_bytes);
    let body = TxBody::decode(built.body_bytes.as_slice()).unwrap();
    let classical_body = TxBody::decode(classical.body_bytes.as_slice()).unwrap();
    assert_eq!(body.messages, classical_body.messages);
    assert_eq!(body.memo, classical_body.memo);
    assert_eq!(body.extension_options.len(), 1);
}

#[test]
fn auto_sign_bytes_asks_the_node_and_caches() {
    let v = vector();

    // v2 applied under the testnet's plan name -> v2.
    let routes = Routes::new()
        .on("applied_plan/v3.2.0", &[(200, json!({ "height": "0" }))])
        .on(
            "applied_plan/v3.1.98",
            &[(200, json!({ "height": "4242" }))],
        );
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        SignBytesMode::Auto,
        false,
    );
    assert_eq!(
        tx.resolve_sign_bytes_version().unwrap(),
        SignBytesVersion::V2
    );
    assert_eq!(
        tx.resolve_sign_bytes_version().unwrap(),
        SignBytesVersion::V2
    );
    assert_eq!(routes.count("applied_plan"), 2, "asked once, then cached");

    // Not applied under any name -> v1.
    let routes = Routes::new().on("applied_plan/", &[(200, json!({}))]);
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        SignBytesMode::Auto,
        false,
    );
    assert_eq!(
        tx.resolve_sign_bytes_version().unwrap(),
        SignBytesVersion::V1
    );
    let b64 = tx.build_signed_tx(&v.msg, &v.opts).unwrap();
    let want = golden()["hybridTx"]["v1"]["txRawHex"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(hex::encode(BASE64.decode(b64).unwrap()), want);

    // A node that cannot answer is an error, never a guess.
    let routes = Routes::new().on("applied_plan/", &[(500, json!({}))]);
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes),
        SignBytesMode::Auto,
        false,
    );
    assert!(tx.resolve_sign_bytes_version().is_err());

    // A chain born with v2 needs no question.
    let routes = Routes::new();
    let account = NativeAccount::from_mnemonic_default(&v.mnemonic).unwrap();
    let tx = RdkTxClient::new_with_options(
        account,
        RestClient::with_transport("http://node.example", routes.clone()),
        "qorechain-local",
        0,
        0,
        HybridSigningOptions {
            pqc_keypair: Some(derive_pqc_canonical(&v.address, &v.mnemonic)),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        tx.resolve_sign_bytes_version().unwrap(),
        SignBytesVersion::V2
    );
    assert!(routes.requests().is_empty());
}

#[test]
fn hybrid_broadcast_retries_once_on_a_sign_bytes_refusal() {
    let v = vector();
    let refused = json!({ "tx_response": {
        "code": 21, "codespace": "pqc", "raw_log": "hybrid PQC signature verification failed"
    }});
    let ok = json!({ "tx_response": { "code": 0, "txhash": "ABCD" } });
    let routes = Routes::new()
        // First asked: not applied (v1). Asked again after the refusal: applied.
        .on(
            "applied_plan/v3.2.0",
            &[
                (200, json!({ "height": "0" })),
                (200, json!({ "height": "99" })),
            ],
        )
        .on("applied_plan/v3.1.98", &[(200, json!({ "height": "0" }))])
        .on("/cosmos/tx/v1beta1/txs", &[(200, refused), (200, ok)]);
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        SignBytesMode::Auto,
        false,
    );
    let resp = tx
        .pause_rollup(&v.msg.rollup_id, "", None, &v.opts)
        .unwrap();
    assert_eq!(resp["tx_response"]["code"], 0);

    let posts: Vec<HttpRequest> = routes
        .requests()
        .into_iter()
        .filter(|r| r.method == Method::Post)
        .collect();
    assert_eq!(posts.len(), 2);
    let sent = |r: &HttpRequest| -> String {
        let body: Value = serde_json::from_str(r.body.as_ref().unwrap()).unwrap();
        assert_eq!(body["mode"], "BROADCAST_MODE_SYNC");
        hex::encode(BASE64.decode(body["tx_bytes"].as_str().unwrap()).unwrap())
    };
    let h = &golden()["hybridTx"];
    assert_eq!(sent(&posts[0]), h["v1"]["txRawHex"].as_str().unwrap());
    assert_eq!(sent(&posts[1]), h["v2"]["txRawHex"].as_str().unwrap());
}

#[test]
fn forced_sign_bytes_is_never_retried() {
    let v = vector();
    let refused = json!({ "tx_response": { "code": 21, "codespace": "pqc", "raw_log": "" } });
    let routes = Routes::new().on("/cosmos/tx/v1beta1/txs", &[(200, refused)]);
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        SignBytesMode::V1,
        false,
    );
    let resp = tx
        .pause_rollup(&v.msg.rollup_id, "", None, &v.opts)
        .unwrap();
    assert_eq!(resp["tx_response"]["code"], 21);
    assert_eq!(routes.requests().len(), 1);
}

#[test]
fn hybrid_client_keeps_the_pre_broadcast_rules() {
    let v = vector();
    let routes = Routes::new();
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        SignBytesMode::V2,
        false,
    );
    assert!(tx.is_hybrid());
    let err = tx
        .create_rollup("Bad Id", "defi", "evm", 1, &v.opts)
        .unwrap_err();
    assert!(matches!(err, TxError::WouldBeRefused(_)));
    assert!(routes.requests().is_empty());
}

#[test]
fn simulate_a_hybrid_tx_offline() {
    let v = vector();
    let routes = Routes::new();
    let tx = hybrid_client(
        &v,
        RestClient::with_transport("http://node.example", routes.clone()),
        SignBytesMode::Auto,
        false,
    );
    assert_eq!(tx.simulate(&v.msg, &v.opts).unwrap(), v.opts.gas_limit);
    assert!(routes.requests().is_empty());
}

#[test]
fn rejects_a_keypair_that_is_not_ml_dsa_87() {
    let v = vector();
    let account = NativeAccount::from_mnemonic_default(&v.mnemonic).unwrap();
    let mut keypair = derive_pqc_canonical(&v.address, &v.mnemonic);
    keypair.secret_key.truncate(10);
    let res = RdkTxClient::new_with_options(
        account,
        RestClient::with_transport("http://node.example", Routes::new()),
        v.chain_id.clone(),
        0,
        0,
        HybridSigningOptions {
            pqc_keypair: Some(keypair),
            ..Default::default()
        },
    );
    assert!(matches!(res, Err(TxError::Build(_))));
}

// --- key resolution ---------------------------------------------------------

fn client_with(routes: Arc<Routes>) -> RdkClient {
    RdkClient::new(RdkClientOptions {
        rest_url: Some("http://node.example".to_string()),
        transport: Some(routes),
        ..Default::default()
    })
}

/// The REST answer for an account whose registered key is `public_key`
/// (gRPC-gateway encodes proto bytes as base64).
fn registered(public_key: &[u8]) -> Value {
    json!({ "account": {
        "address": "qor1...",
        "public_key": BASE64.encode(public_key),
        "algorithm_id": 1,
        "algorithm_name": "dilithium5",
    }})
}

#[test]
fn resolves_canonical_and_embeds_it_when_not_registered() {
    let v = vector();
    let routes = Routes::new();
    let r = resolve_pqc_keypair(&client_with(routes.clone()), &v.address, &v.mnemonic).unwrap();
    assert_eq!(r.derivation, PqcDerivation::Canonical);
    assert!(!r.registered);
    assert!(r.include_pqc_public_key);
    assert_eq!(
        r.keypair.public_key,
        derive_pqc_canonical(&v.address, &v.mnemonic).public_key
    );
    assert_eq!(routes.count("/qorechain/pqc/v1/account/"), 1);
    assert!(routes.requests()[0].url.ends_with(&v.address));

    // The resolved key, as options, signs the golden v1WithKey vector.
    let mut opts = HybridSigningOptions::from(r);
    opts.sign_bytes_version = SignBytesMode::V1;
    let account = NativeAccount::from_mnemonic_default(&v.mnemonic).unwrap();
    let tx = RdkTxClient::new_with_options(
        account,
        RestClient::with_transport("http://node.example", Routes::new()),
        v.chain_id.clone(),
        v.account_number,
        v.sequence,
        opts,
    )
    .unwrap();
    let b64 = tx.build_signed_tx(&v.msg, &v.opts).unwrap();
    assert_eq!(
        hex::encode(BASE64.decode(b64).unwrap()),
        golden()["hybridTx"]["v1WithKey"]["txRawHex"]
            .as_str()
            .unwrap()
    );
}

#[test]
fn resolves_registered_canonical() {
    let v = vector();
    let canonical = derive_pqc_canonical(&v.address, &v.mnemonic);
    let routes = Routes::new().on(
        "/qorechain/pqc/v1/account/",
        &[(200, registered(&canonical.public_key))],
    );
    let r = resolve_pqc_keypair(&client_with(routes), &v.address, &v.mnemonic).unwrap();
    assert_eq!(r.derivation, PqcDerivation::Canonical);
    assert!(r.registered);
    assert!(!r.include_pqc_public_key);
    assert_eq!(r.keypair.public_key, canonical.public_key);
}

#[test]
fn resolves_registered_legacy() {
    let v = vector();
    let legacy = derive_pqc_legacy(&v.mnemonic);
    let routes = Routes::new().on(
        "/qorechain/pqc/v1/account/",
        &[(200, registered(&legacy.public_key))],
    );
    let r = resolve_pqc_keypair(&client_with(routes), &v.address, &v.mnemonic).unwrap();
    assert_eq!(r.derivation, PqcDerivation::Legacy);
    assert!(r.registered);
    assert!(!r.include_pqc_public_key);
    assert_eq!(r.keypair.public_key, legacy.public_key);
    assert_ne!(
        legacy.public_key,
        derive_pqc_canonical(&v.address, &v.mnemonic).public_key
    );
}

#[test]
fn refuses_a_foreign_registered_key() {
    let v = vector();
    let foreign = pqc_keypair_from_seed(&[9u8; 32]);
    let routes = Routes::new().on(
        "/qorechain/pqc/v1/account/",
        &[(200, registered(&foreign.public_key))],
    );
    let err = resolve_pqc_keypair(&client_with(routes), &v.address, &v.mnemonic).unwrap_err();
    assert_eq!(
        err.to_string(),
        format!(
            "account {} has a post-quantum key on chain that neither the canonical nor the legacy \
             derivation of this mnemonic produces, so it was registered from another secret. Supply \
             that keypair explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this \
             account.",
            v.address
        )
    );
}

#[test]
fn env_seed_must_match_the_registered_key() {
    let v = vector();
    let seed = [7u8; 32];
    let seed_hex = hex::encode(seed);
    let env = |key: &str| (key == "QORE_PQC_SEED_HEX").then(|| seed_hex.clone());

    // Not registered: the seed's key, embedded.
    let r = pqc_keypair_from_env_with(&client_with(Routes::new()), &v.address, env)
        .unwrap()
        .unwrap();
    assert_eq!(r.derivation, PqcDerivation::Seed);
    assert!(!r.registered);
    assert!(r.include_pqc_public_key);
    assert_eq!(
        r.keypair.public_key,
        pqc_keypair_from_seed(&seed).public_key
    );

    // Registered with the seed's key.
    let routes = Routes::new().on(
        "/qorechain/pqc/v1/account/",
        &[(200, registered(&pqc_keypair_from_seed(&seed).public_key))],
    );
    let r = pqc_keypair_from_env_with(&client_with(routes), &v.address, env)
        .unwrap()
        .unwrap();
    assert!(r.registered);
    assert!(!r.include_pqc_public_key);

    // Registered with another key: refused.
    let other = derive_pqc_canonical(&v.address, &v.mnemonic);
    let routes = Routes::new().on(
        "/qorechain/pqc/v1/account/",
        &[(200, registered(&other.public_key))],
    );
    let err = pqc_keypair_from_env_with(&client_with(routes), &v.address, env).unwrap_err();
    assert_eq!(
        err.to_string(),
        format!(
            "QORE_PQC_SEED_HEX does not produce the post-quantum key registered for {}; every \
             hybrid transaction signed with it would be refused",
            v.address
        )
    );

    // A seed of the wrong length.
    let short = |key: &str| (key == "QORE_PQC_SEED_HEX").then(|| "abcd".to_string());
    let err =
        pqc_keypair_from_env_with(&client_with(Routes::new()), &v.address, short).unwrap_err();
    assert_eq!(err.to_string(), "QORE_PQC_SEED_HEX must be 32 bytes, got 2");
}

#[test]
fn env_prefers_the_seed_then_the_mnemonic_then_none() {
    let v = vector();
    let mnemonic = v.mnemonic.clone();
    let seed_hex = hex::encode([7u8; 32]);

    let both = |key: &str| match key {
        "QORE_PQC_SEED_HEX" => Some(seed_hex.clone()),
        "QORE_MNEMONIC" => Some(mnemonic.clone()),
        _ => None,
    };
    let r = pqc_keypair_from_env_with(&client_with(Routes::new()), &v.address, both)
        .unwrap()
        .unwrap();
    assert_eq!(r.derivation, PqcDerivation::Seed);

    let only_mnemonic = |key: &str| (key == "QORE_MNEMONIC").then(|| format!("  {mnemonic} "));
    let r = pqc_keypair_from_env_with(&client_with(Routes::new()), &v.address, only_mnemonic)
        .unwrap()
        .unwrap();
    assert_eq!(r.derivation, PqcDerivation::Canonical);
    assert_eq!(
        r.keypair.public_key,
        derive_pqc_canonical(&v.address, &v.mnemonic).public_key
    );

    let none =
        pqc_keypair_from_env_with(&client_with(Routes::new()), &v.address, |_| None).unwrap();
    assert!(none.is_none());
}
