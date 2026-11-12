//! Chain v3.2.7 / v3.2.8 support, checked against the shared vectors in
//! `v328.json` (generated from the chain's own code and tx.proto).

use std::sync::{Arc, Mutex};

use prost::Message;
use serde_json::{json, Value};

use qorechain_rdk::accounts::NativeAccount;
use qorechain_rdk::client::http::{HttpError, HttpRequest, HttpResponse, Transport};
use qorechain_rdk::client::rest::RestClient;
use qorechain_rdk::client::views::{
    map_batch_view, map_params_view, map_rollup_view, map_submitter_bond_view,
};
use qorechain_rdk::config::{
    is_proof_compatible, rollup_mode_errors, validate_rollup_config, ExecutionVm, Profile,
    ProofSystem, RollupModeInput, SequencingMode, Settlement,
};
use qorechain_rdk::errors::decode_rdk_tx_error;
use qorechain_rdk::inbox::{
    inbox_accumulate, inbox_range_hash, posted_data_hash, InboxAccumulateInput, InboxRangeInput,
};
use qorechain_rdk::presets::{preset, preset_defaults};
use qorechain_rdk::privpost::{
    envelope_membership_error, envelope_membership_error_by_fingerprint, parse_envelope,
    EnvelopeRecipient, RecipientsError,
};
use qorechain_rdk::rules::data_hash_error_with;
use qorechain_rdk::tx::codecs::{MsgPostRollupDataResponse, MsgSetRollupMembers, RdkMsg};
use qorechain_rdk::tx::messages::{
    BondRollupSubmitterInput, CreateRollupInput, DepositToRollupInput, PostRollupDataInput,
    RegisterKemKeyInput, SetRollupMembersInput, SetRollupSequencingInput, SetVerificationKeyInput,
    SubmitBatchInput, UnbondRollupSubmitterInput, UpdateVerificationKeyInput,
};
use qorechain_rdk::tx::{RdkTxClient, TxOptions};
use qorechain_rdk::zk::{
    is_canonical_scalar, is_data_hash_chain_bound, to_canonical_scalar, zk_public_input_errors,
    ZkBatchInputs, BLS12_381_SCALAR_MODULUS,
};

const GOLDEN_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn v() -> Value {
    serde_json::from_str(include_str!("v328.json")).expect("v328.json parses")
}

fn h(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

fn unhex(s: &str) -> Vec<u8> {
    hex::decode(s).unwrap()
}

fn s(x: &str) -> String {
    x.to_string()
}

#[test]
fn create_rollup_carries_fields_6_to_9() {
    let msg = CreateRollupInput {
        creator: s("qor1creator"),
        rollup_id: s("my-rollup"),
        profile: s("nft"),
        vm_type: s("native"),
        stake_amount: 10_000_000_000,
        verification_key: vec![9, 8, 7],
        sequencing: s("based"),
        execution_vm: s("qledger-v1"),
        privacy: s("encapsulated"),
    }
    .to_msg();
    assert_eq!(
        h(&msg.encode_to_vec_msg()),
        v()["msgProtoHex"]["MsgCreateRollupV328"].as_str().unwrap()
    );
}

#[test]
fn submit_batch_carries_inbox_end() {
    let msg = SubmitBatchInput {
        sequencer: s("qor1seq"),
        rollup_id: s("r1"),
        batch_index: 7,
        state_root: vec![1, 2, 3],
        tx_count: 42,
        data_hash: vec![9, 9],
        inbox_end: 300,
        ..Default::default()
    }
    .to_msg();
    assert_eq!(
        h(&msg.encode_to_vec_msg()),
        v()["msgProtoHex"]["MsgSubmitBatchV328"].as_str().unwrap()
    );
}

#[test]
fn new_messages_match_the_chain_bytes() {
    let fx = v();
    let want = |name: &str| fx["msgProtoHex"][name].as_str().unwrap().to_string();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        (
            "MsgSetVerificationKey",
            SetVerificationKeyInput {
                creator: s("qor1creator"),
                rollup_id: s("r1"),
                verification_key: unhex("01020304"),
                proof_system: s("snark"),
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgUpdateVerificationKey",
            UpdateVerificationKeyInput {
                authority: s("qor1gov"),
                rollup_id: s("r1"),
                verification_key: unhex("0506"),
                proof_system: s("snark"),
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgPostRollupData",
            PostRollupDataInput {
                poster: s("qor1poster"),
                rollup_id: s("r1"),
                data: b"hello".to_vec(),
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgSetRollupSequencing",
            SetRollupSequencingInput {
                authority: s("qor1gov"),
                rollup_id: s("r1"),
                sequencing: s("based"),
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgDepositToRollup",
            DepositToRollupInput {
                depositor: s("qor1dep"),
                rollup_id: s("r1"),
                account: unhex(&format!("{}01", "00".repeat(31))),
                amount: 1_000_000,
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgBondRollupSubmitter",
            BondRollupSubmitterInput {
                submitter: s("qor1sub"),
                rollup_id: s("r1"),
                amount: 1_000_000_000,
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgUnbondRollupSubmitter",
            UnbondRollupSubmitterInput {
                submitter: s("qor1sub"),
                rollup_id: s("r1"),
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgSetRollupMembers",
            SetRollupMembersInput {
                creator: s("qor1creator"),
                rollup_id: s("r1"),
                members: vec![s("qor1a"), s("qor1b")],
            }
            .to_msg()
            .encode_to_vec(),
        ),
        (
            "MsgRegisterKEMKey",
            RegisterKemKeyInput {
                sender: s("qor1member"),
                public_key: unhex("01020304"),
                ..Default::default()
            }
            .to_msg()
            .encode_to_vec(),
        ),
    ];
    for (name, bytes) in cases {
        assert_eq!(h(&bytes), want(name), "{name}");
    }
}

#[test]
fn type_urls() {
    use qorechain_rdk::tx::codecs::{MsgRegisterKemKey, MsgSetVerificationKey};
    assert_eq!(
        MsgSetVerificationKey::type_url(),
        "/qorechain.rdk.v1.MsgSetVerificationKey"
    );
    assert_eq!(
        MsgRegisterKemKey::type_url(),
        "/qorechain.pqc.v1.MsgRegisterKEMKey"
    );
    assert_eq!(RegisterKemKeyInput::default().algorithm_id, 2);
}

#[test]
fn decodes_post_rollup_data_response_and_round_trips() {
    let raw = unhex(
        v()["msgProtoHex"]["MsgPostRollupDataResponse"]
            .as_str()
            .unwrap(),
    );
    let r = MsgPostRollupDataResponse::decode(raw.as_slice()).unwrap();
    assert_eq!(r.sequence, 5);
    assert_eq!(h(&r.data_hash), "aabb");
    let m = SetRollupMembersInput {
        creator: s("c"),
        rollup_id: s("r"),
        members: vec![s("a"), s("b")],
    }
    .to_msg();
    assert_eq!(
        MsgSetRollupMembers::decode(m.encode_to_vec().as_slice()).unwrap(),
        m
    );
}

#[test]
fn inbox_accumulator_and_range_match_the_chain() {
    let fx = v();
    let ib = &fx["inbox"];
    let chain_id = ib["chainId"].as_str().unwrap();
    let rollup_id = ib["rollupId"].as_str().unwrap();
    let mut acc: Vec<u8> = Vec::new();
    let mut accs = Vec::new();
    for p in ib["posts"].as_array().unwrap() {
        let data_hash = posted_data_hash(&unhex(p["dataHex"].as_str().unwrap()));
        assert_eq!(h(&data_hash), p["dataHash"].as_str().unwrap());
        let next = inbox_accumulate(&InboxAccumulateInput {
            chain_id,
            rollup_id,
            prev_acc: &acc,
            sequence: p["sequence"].as_u64().unwrap(),
            height: p["height"].as_u64().unwrap(),
            poster: p["poster"].as_str().unwrap(),
            data_hash: &data_hash,
        });
        assert_eq!(h(&next), p["acc"].as_str().unwrap());
        acc = next.to_vec();
        accs.push(next);
    }
    let r03 = inbox_range_hash(&InboxRangeInput {
        chain_id,
        rollup_id,
        from: 0,
        to: 3,
        acc_from: &[],
        acc_to: &accs[2],
    });
    assert_eq!(h(&r03), ib["range_0_3"].as_str().unwrap());
    let r13 = inbox_range_hash(&InboxRangeInput {
        chain_id,
        rollup_id,
        from: 1,
        to: 3,
        acc_from: &accs[0],
        acc_to: &accs[2],
    });
    assert_eq!(h(&r13), ib["range_1_3"].as_str().unwrap());
}

#[test]
fn canonical_scalars_match_the_chain() {
    let fx = v();
    assert_eq!(
        h(&BLS12_381_SCALAR_MODULUS),
        fx["zk"]["modulus"].as_str().unwrap()
    );
    for c in fx["zk"]["cases"].as_array().unwrap() {
        let value = unhex(c["value"].as_str().unwrap());
        assert_eq!(
            is_canonical_scalar(&value),
            c["canonical"].as_bool().unwrap(),
            "{c}"
        );
        assert_eq!(
            h(&to_canonical_scalar(&value)),
            c["reduced"].as_str().unwrap()
        );
    }
}

#[test]
fn zk_input_errors_name_each_refused_input() {
    let high = [0xffu8; 32];
    let mut ok = [0u8; 32];
    ok[31] = 1;
    let none = zk_public_input_errors(
        &ZkBatchInputs {
            prev_state_root: &ok,
            state_root: &ok,
            data_hash: &ok,
            ..Default::default()
        },
        false,
    );
    assert!(none.is_empty());
    // withdrawals_root may be any 32 bytes (the chain stores it mod r).
    let two = zk_public_input_errors(
        &ZkBatchInputs {
            state_root: &high,
            data_hash: &high,
            withdrawals_root: &high,
            ..Default::default()
        },
        false,
    );
    assert_eq!(two.len(), 2);
    let bound = zk_public_input_errors(
        &ZkBatchInputs {
            state_root: &ok,
            data_hash: &high,
            ..Default::default()
        },
        true,
    );
    assert!(bound.is_empty());
    assert!(zk_public_input_errors(
        &ZkBatchInputs {
            state_root: &ok,
            withdrawals_root: &[],
            ..Default::default()
        },
        false
    )
    .is_empty());
    assert!(is_data_hash_chain_bound("celestia", "based", &[]));
    assert!(is_data_hash_chain_bound("native", "", &high));
    assert!(!is_data_hash_chain_bound("native", "", &[]));
    assert!(!is_data_hash_chain_bound("celestia", "", &high));
}

#[test]
fn parses_the_chains_envelope_and_mirrors_the_membership_check() {
    let fx = v();
    let p = &fx["privpost"];
    let envelope = unhex(p["envelope"].as_str().unwrap());
    let env = parse_envelope(&envelope).unwrap();
    assert_eq!(env.epoch, p["epoch"].as_u64().unwrap());
    let members: Vec<(String, [u8; 32])> = p["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            let fp: [u8; 32] = unhex(m["ekSha256"].as_str().unwrap()).try_into().unwrap();
            (m["member"].as_str().unwrap().to_string(), fp)
        })
        .collect();
    let names: Vec<&str> = env.entries.iter().map(|e| e.member.as_str()).collect();
    assert_eq!(
        names,
        members.iter().map(|(m, _)| m.as_str()).collect::<Vec<_>>()
    );
    for (entry, (_, fp)) in env.entries.iter().zip(&members) {
        assert_eq!(&entry.fingerprint, fp);
        assert_eq!(entry.kem_ciphertext.len(), 1568);
        assert_eq!(entry.wrapped_key.len(), 48);
    }
    assert_eq!(env.header.len() + env.ciphertext.len(), envelope.len());

    let refs: Vec<(&str, [u8; 32])> = members.iter().map(|(m, f)| (m.as_str(), *f)).collect();
    let epoch = env.epoch;
    assert_eq!(
        envelope_membership_error_by_fingerprint(&envelope, epoch, &refs),
        None
    );
    assert!(
        envelope_membership_error_by_fingerprint(&envelope, epoch + 1, &refs)
            .unwrap()
            .contains("epoch")
    );
    let reversed: Vec<_> = refs.iter().rev().cloned().collect();
    assert!(
        envelope_membership_error_by_fingerprint(&envelope, epoch, &reversed)
            .unwrap()
            .contains("entry 0")
    );
    assert!(
        envelope_membership_error_by_fingerprint(&envelope, epoch, &refs[..1])
            .unwrap()
            .contains("2 entries")
    );
    assert!(
        envelope_membership_error_by_fingerprint(&envelope, epoch, &[])
            .unwrap()
            .contains("no members")
    );
    // A key that is not the member's registered one.
    let wrong: Vec<EnvelopeRecipient> = members
        .iter()
        .map(|(m, _)| EnvelopeRecipient {
            member: m.clone(),
            encapsulation_key: vec![0u8; 1568],
        })
        .collect();
    assert!(envelope_membership_error(&envelope, epoch, &wrong)
        .unwrap()
        .contains("registered KEM key"));

    // Malformed input.
    let mut tampered = envelope.clone();
    tampered[4] = 2;
    assert!(parse_envelope(&tampered)
        .unwrap_err()
        .to_string()
        .contains("malformed"));
    assert!(parse_envelope(&envelope[..env.header.len() + 15])
        .unwrap_err()
        .to_string()
        .contains("payload shorter than its tag"));
}

#[test]
fn optimistic_presets_run_qledger_v1_and_are_based() {
    for profile in [Profile::Nft, Profile::Custom] {
        let d = preset_defaults(profile);
        assert_eq!(d.execution_vm, Some(ExecutionVm::QledgerV1));
        assert_eq!(d.sequencing, Some(SequencingMode::Based));
        let b = preset(profile).set_rollup_id("my-rollup");
        assert_eq!(b.validation_result().errors, Vec::<String>::new());
        let msg = b.to_create_msg("qor1c", Some(s("1"))).unwrap();
        assert_eq!(msg.execution_vm, Some(ExecutionVm::QledgerV1));
        assert_eq!(msg.sequencing, Some(SequencingMode::Based));
    }
}

#[test]
fn refuses_optimistic_without_execution_vm_and_stark() {
    let config = preset(Profile::Custom)
        .set_rollup_id("my-rollup")
        .set_execution_vm(None)
        .set_sequencing(None)
        .get();
    assert!(!validate_rollup_config(&config).valid);
    assert!(!is_proof_compatible(Settlement::Zk, ProofSystem::Stark));
    let mut stark = preset(Profile::Defi).set_rollup_id("my-rollup").get();
    stark.proof_system = ProofSystem::Stark;
    assert!(validate_rollup_config(&stark)
        .errors
        .join(",")
        .contains("paused"));
}

#[test]
fn manifest_reads_empty_mode_strings_as_unset() {
    let config = preset(Profile::Defi).set_rollup_id("my-rollup").get();
    let mut j = serde_json::to_value(&config).unwrap();
    assert!(j.get("executionVm").is_none());
    j["executionVm"] = json!("");
    j["sequencing"] = json!("");
    let back: qorechain_rdk::RollupConfig = serde_json::from_value(j).unwrap();
    assert_eq!(back, config);
    let nft = preset(Profile::Nft).set_rollup_id("my-rollup").get();
    let j = serde_json::to_value(&nft).unwrap();
    assert_eq!(j["executionVm"], "qledger-v1");
    assert_eq!(j["sequencing"], "based");
}

fn mode<'a>(
    settlement: &'a str,
    proof_system: &'a str,
    sequencing: &'a str,
    execution_vm: &'a str,
    privacy: &'a str,
) -> Vec<String> {
    rollup_mode_errors(&RollupModeInput {
        settlement,
        proof_system,
        sequencing,
        execution_vm,
        privacy,
    })
}

#[test]
fn mirrors_the_chains_mode_matrix() {
    assert!(mode("zk", "snark", "based", "", "encapsulated").is_empty());
    assert!(mode("based", "none", "based", "", "").is_empty());
    assert_eq!(mode("sovereign", "none", "based", "", "").len(), 1);
    assert!(mode("zk", "snark", "based", "qledger-v1", "")
        .join(",")
        .contains("optimistic"));
    assert!(mode("optimistic", "fraud", "", "qledger-v1", "")
        .join(",")
        .contains("based"));
    assert!(!mode("optimistic", "fraud", "based", "qledger-v1", "encapsulated").is_empty());
    assert!(mode("based", "none", "", "", "encapsulated")
        .join(",")
        .contains("private rollup"));
    assert!(mode("zk", "snark", "bogus", "", "")
        .join(",")
        .contains("not valid"));
}

#[test]
fn native_data_hash_passes_once_posted_data_is_on() {
    assert!(data_hash_error_with("native", &[0xab], false).is_some());
    assert!(data_hash_error_with("native", &[0xab], true).is_none());
}

#[test]
fn names_the_v328_refusals() {
    let k = |c| decode_rdk_tx_error(c, "rdk", "").unwrap().kind;
    assert_eq!(k(48), "invalid_rollup_mode");
    assert_eq!(k(52), "stark_statement_unsupported");
    assert_eq!(k(46), "invalid_inbox_range");
    assert_eq!(k(37), "verification_key_disabled");
    assert_eq!(k(54), "deposit_pool_not_empty");
    let vk = decode_rdk_tx_error(21, "rdk", "x").unwrap();
    assert_eq!(vk.kind, "verification_key_missing");
    assert_eq!(vk.raw_log, "x");
    let other = decode_rdk_tx_error(5, "sdk", "").unwrap();
    assert_eq!(other.codespace, "sdk");
    assert!(other.kind.is_empty());
    assert_eq!(
        decode_rdk_tx_error(999, "rdk", "raw").unwrap().raw_log,
        "raw"
    );
    assert!(decode_rdk_tx_error(0, "rdk", "").is_none());
}

#[test]
fn views_map_the_v328_fields() {
    let r = map_rollup_view(&json!({
        "rollup_id": "r", "sequencing": "based", "execution_vm": "qledger-v1",
        "privacy": "", "members": ["qor1a", "qor1b"], "members_epoch": "3",
        "deposit_pool": "5000000"
    }));
    assert_eq!(r.sequencing, "based");
    assert_eq!(r.execution_vm, "qledger-v1");
    assert_eq!(r.members, vec![s("qor1a"), s("qor1b")]);
    assert_eq!(r.members_epoch, 3);
    assert_eq!(r.deposit_pool, "5000000");
    let old = map_rollup_view(&json!({ "rollup_id": "r" }));
    assert_eq!(old.deposit_pool, "0");
    assert!(old.members.is_empty());

    let b = map_batch_view(&json!({ "inbox_start": "4", "inboxEnd": 9 }));
    assert_eq!((b.inbox_start, b.inbox_end), (4, 9));

    let p = map_params_view(
        &json!({ "max_posted_data_bytes": "65536", "min_submitter_bond": "1000000000" }),
    );
    assert_eq!(p.max_posted_data_bytes, Some(65536));
    assert_eq!(p.min_submitter_bond.as_deref(), Some("1000000000"));
    assert_eq!(p.posted_data_fee_per_byte, None);

    let bond = map_submitter_bond_view(&json!({}));
    assert_eq!(bond.amount, "0");
}

/// A node answering by route, recording URLs and broadcasts.
struct Node {
    rollup: Value,
    features: Vec<&'static str>,
    kem: Value,
    urls: Mutex<Vec<String>>,
}

impl Node {
    fn new(rollup: Value, features: Vec<&'static str>) -> Arc<Self> {
        Arc::new(Node {
            rollup,
            features,
            kem: json!({ "found": false }),
            urls: Mutex::new(Vec::new()),
        })
    }

    fn posted(&self) -> bool {
        self.urls
            .lock()
            .unwrap()
            .iter()
            .any(|u| u.ends_with("/cosmos/tx/v1beta1/txs"))
    }

    fn saw(&self, needle: &str) -> bool {
        self.urls.lock().unwrap().iter().any(|u| u.contains(needle))
    }
}

impl Transport for Node {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let url = request.url.clone();
        self.urls.lock().unwrap().push(url.clone());
        let body = if url.contains("/protocol_features") {
            json!({ "features": self.features.iter().map(|f| json!({ "name": f, "enabled": true })).collect::<Vec<_>>() })
        } else if url.contains("/rdk/v1/rollup/") {
            json!({ "rollup": self.rollup })
        } else if url.contains("/pqc/v1/kem/") {
            self.kem.clone()
        } else if url.contains("/rdk/v1/inbox/")
            || url.contains("/posted_data/")
            || url.contains("/submitter_bond/")
        {
            json!({})
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

fn tx(node: Arc<Node>) -> RdkTxClient<NativeAccount> {
    let rest = RestClient::with_transport("http://node.example", node);
    let account = NativeAccount::from_mnemonic_default(GOLDEN_MNEMONIC).unwrap();
    RdkTxClient::new(account, rest, "qorechain-diana", 0, 0)
}

fn refused(r: Result<Value, qorechain_rdk::tx::TxError>, needle: &str) {
    let e = r.unwrap_err().to_string();
    assert!(e.contains(needle), "{e}");
}

#[test]
fn rest_routes() {
    let node = Node::new(json!({}), vec![]);
    let rest = RestClient::with_transport("http://node.example", node.clone());
    rest.get_inbox("r1", 0).unwrap();
    rest.get_inbox("r1", 7).unwrap();
    rest.get_posted_data("r1", 3).unwrap();
    rest.get_submitter_bond("r1", "qor1sub").unwrap();
    assert!(rest.get_kem_key("qor1a").unwrap().is_none());
    let urls = node.urls.lock().unwrap().clone();
    assert!(urls[0].ends_with("/qorechain/rdk/v1/inbox/r1"));
    assert!(urls[1].ends_with("/qorechain/rdk/v1/inbox/r1?inbox_end=7"));
    assert!(urls[2].ends_with("/qorechain/rdk/v1/posted_data/r1/3"));
    assert!(urls[3].ends_with("/qorechain/rdk/v1/submitter_bond/r1/qor1sub"));
    assert!(urls[4].ends_with("/qorechain/pqc/v1/kem/qor1a"));
}

#[test]
fn private_rollup_recipients() {
    let key_hex = "ab".repeat(1568);
    let private = json!({ "rollup_id": "p", "privacy": "encapsulated", "members": ["qor1a"], "members_epoch": "4" });
    let with_key = Arc::new(Node {
        rollup: private.clone(),
        features: vec![],
        kem: json!({ "found": true, "key": { "address": "qor1a", "algorithm_id": 2, "public_key": key_hex } }),
        urls: Mutex::new(Vec::new()),
    });
    let rest = RestClient::with_transport("http://node.example", with_key);
    let r = rest.get_private_rollup_recipients("p").unwrap();
    assert_eq!(r.epoch, 4);
    assert_eq!(r.recipients.len(), 1);
    assert_eq!(r.recipients[0].member, "qor1a");
    assert_eq!(r.recipients[0].encapsulation_key, vec![0xab; 1568]);

    let wrong_alg = Arc::new(Node {
        rollup: private.clone(),
        features: vec![],
        kem: json!({ "found": true, "key": { "algorithm_id": 1, "public_key": "00" } }),
        urls: Mutex::new(Vec::new()),
    });
    let rest = RestClient::with_transport("http://node.example", wrong_alg);
    assert!(matches!(
        rest.get_private_rollup_recipients("p"),
        Err(RecipientsError::NoKemKey(_))
    ));
    let rest = RestClient::with_transport("http://node.example", Node::new(private, vec![]));
    assert!(matches!(
        rest.get_private_rollup_recipients("p"),
        Err(RecipientsError::NoKemKey(_))
    ));
    let rest = RestClient::with_transport(
        "http://node.example",
        Node::new(json!({ "rollup_id": "p" }), vec![]),
    );
    assert!(matches!(
        rest.get_private_rollup_recipients("p"),
        Err(RecipientsError::NotPrivate(_))
    ));
    let rest = RestClient::with_transport(
        "http://node.example",
        Node::new(json!({ "privacy": "encapsulated" }), vec![]),
    );
    assert!(matches!(
        rest.get_private_rollup_recipients("p"),
        Err(RecipientsError::NoMembers(_))
    ));
}

#[test]
fn create_rollup_checks_the_mode_rules_before_paying() {
    let node = Node::new(json!({}), vec![]);
    let o = TxOptions::default();
    refused(
        tx(node.clone()).create_rollup("my-rollup", "nft", "native", 1, &o),
        "would be refused",
    );
    assert!(!node.posted());
    tx(node.clone())
        .create_rollup_with(
            CreateRollupInput {
                rollup_id: s("my-rollup"),
                profile: s("nft"),
                vm_type: s("native"),
                stake_amount: 1,
                sequencing: s("based"),
                execution_vm: s("qledger-v1"),
                ..Default::default()
            },
            &o,
        )
        .unwrap();
    assert!(node.posted());
}

#[test]
fn submit_batch_pre_checks() {
    let o = TxOptions::default();
    let batch = |inbox_end: u64, data_hash: Vec<u8>, root: Vec<u8>| SubmitBatchInput {
        rollup_id: s("r"),
        batch_index: 1,
        state_root: root,
        inbox_end,
        data_hash,
        ..Default::default()
    };

    // Based rollup: inbox_end is required.
    let node = Node::new(
        json!({ "sequencing": "based", "da_backend": "native" }),
        vec![],
    );
    refused(
        tx(node.clone()).submit_batch(batch(0, vec![], vec![1; 32]), &o),
        "the rollup is based",
    );
    assert!(!node.posted());
    tx(node.clone())
        .submit_batch(batch(3, vec![0xff; 32], vec![1; 32]), &o)
        .unwrap();
    assert!(node.posted());

    // Not based: inbox_end must be 0; a native data hash needs posted data.
    let node = Node::new(json!({ "da_backend": "native" }), vec![]);
    refused(
        tx(node.clone()).submit_batch(batch(3, vec![], vec![1; 32]), &o),
        "inbox_end must be 0",
    );
    refused(
        tx(node.clone()).submit_batch(batch(0, vec![1; 32], vec![1; 32]), &o),
        "must be empty",
    );
    assert!(!node.posted());
    let node = Node::new(
        json!({ "da_backend": "native" }),
        vec!["rdk-post-rollup-data"],
    );
    tx(node.clone())
        .submit_batch(batch(0, vec![1; 32], vec![1; 32]), &o)
        .unwrap();
    assert!(node.posted());

    // zk: canonical inputs once the switch is on.
    let zk = json!({ "settlement_mode": "zk", "proof_system": "snark", "da_backend": "celestia" });
    let node = Node::new(zk.clone(), vec!["rdk-zk-canonical-inputs"]);
    refused(
        tx(node.clone()).submit_batch(batch(0, vec![], vec![0xff; 32]), &o),
        "state_root is not a canonical",
    );
    assert!(!node.posted());
    let node = Node::new(zk, vec![]);
    tx(node.clone())
        .submit_batch(batch(0, vec![], vec![0xff; 32]), &o)
        .unwrap();
    assert!(node.posted());

    // zk STARK: paused once the switch is on.
    let stark = json!({ "settlement_mode": "zk", "proof_system": "stark" });
    let node = Node::new(stark, vec!["rdk-stark-statement"]);
    refused(
        tx(node.clone()).submit_batch(batch(0, vec![], vec![1; 32]), &o),
        "STARK settlement is paused",
    );
    assert!(!node.posted());
    assert!(node.saw("/rdk/v1/rollup/r"));
}

#[test]
fn v328_tx_methods_check_their_inputs() {
    let o = TxOptions::default();
    let node = Node::new(json!({}), vec![]);
    let c = tx(node.clone());
    refused(
        c.set_verification_key(
            SetVerificationKeyInput {
                rollup_id: s("r"),
                verification_key: vec![1],
                proof_system: s("stark"),
                ..Default::default()
            },
            &o,
        ),
        "STARK keys are refused",
    );
    refused(c.post_rollup_data("r", vec![], &o), "cannot be empty");
    refused(
        c.deposit_to_rollup("r", &[0u8; 32], 1_000_000, &o),
        "non-zero",
    );
    refused(
        c.deposit_to_rollup("r", &[1u8; 31], 1_000_000, &o),
        "32-byte",
    );
    refused(
        c.deposit_to_rollup("r", &[1u8; 32], 999_999, &o),
        "at least",
    );
    refused(c.bond_rollup_submitter("r", 0, &o), "positive");
    refused(c.set_rollup_members("r", vec![], &o), "1 to 32");
    refused(
        c.set_rollup_members("r", (0..33).map(|i| format!("qor1m{i}")).collect(), &o),
        "1 to 32",
    );
    refused(
        c.set_rollup_members("r", vec![s("qor1a"), s("qor1a")], &o),
        "listed twice",
    );
    refused(c.register_kem_key(&[0u8; 32], &o), "1568 bytes");
    assert!(!node.posted());

    c.set_verification_key(
        SetVerificationKeyInput {
            rollup_id: s("r"),
            verification_key: vec![1],
            proof_system: s("snark"),
            ..Default::default()
        },
        &o,
    )
    .unwrap();
    c.post_rollup_data("r", b"hello".to_vec(), &o).unwrap();
    c.deposit_to_rollup("r", &[1u8; 32], 1_000_000, &o).unwrap();
    c.bond_rollup_submitter("r", 1, &o).unwrap();
    c.unbond_rollup_submitter("r", &o).unwrap();
    c.set_rollup_members("r", vec![s("qor1a"), s("qor1b")], &o)
        .unwrap();
    c.register_kem_key(&[7u8; 1568], &o).unwrap();
    assert!(node.posted());
}
