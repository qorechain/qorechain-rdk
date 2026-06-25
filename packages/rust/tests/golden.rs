//! Integration tests asserting the Rust crate reproduces the TypeScript
//! reference's golden fixtures exactly.

use serde_json::Value;

use qorechain_rdk::accounts::NativeAccount;
use qorechain_rdk::bridge::merkle::{
    binary_merkle_proof, binary_merkle_root, verify_binary_merkle_proof, MerkleOptions,
};
use qorechain_rdk::bridge::withdrawal::assemble_withdrawal_proof;
use qorechain_rdk::config::Profile;
use qorechain_rdk::presets::preset_defaults;
use qorechain_rdk::tx::codecs::RdkMsg;
use qorechain_rdk::tx::messages::{
    CreateRollupInput, ExecuteWithdrawalInput, PauseRollupInput, SubmitBatchInput,
};
use qorechain_rdk::utils::denom::{qor_to_uqor, uqor_to_qor};
use qorechain_rdk::utils::economics::estimate_creation_cost;

fn golden() -> Value {
    let raw = include_str!("golden.json");
    serde_json::from_str(raw).expect("golden.json parses")
}

#[test]
fn address_derivation_matches_golden() {
    let g = golden();
    let mnemonic = g["mnemonic"].as_str().unwrap();
    let expected = g["nativeAddress"].as_str().unwrap();
    let acct = NativeAccount::from_mnemonic_default(mnemonic).unwrap();
    assert_eq!(acct.address(), expected);

    // The private key derived along the path matches the golden hex too.
    let expected_pk = g["privateKeyHex"].as_str().unwrap();
    let from_pk =
        NativeAccount::from_private_key(&hex::decode(expected_pk).unwrap(), "qor").unwrap();
    assert_eq!(from_pk.address(), expected);
}

#[test]
fn denom_matches_golden() {
    let g = golden();
    let d = &g["denom"];
    assert_eq!(
        qor_to_uqor("1.5", 6).unwrap(),
        d["qorToUqor_1_5"].as_str().unwrap()
    );
    assert_eq!(
        uqor_to_qor("10000000000", 6).unwrap(),
        d["uqorToQor_1e10"].as_str().unwrap()
    );
    assert_eq!(
        qor_to_uqor("0.000001", 6).unwrap(),
        d["qorToUqor_0_000001"].as_str().unwrap()
    );
}

#[test]
fn economics_matches_golden() {
    let g = golden();
    let e = &g["economics"];
    let cost = estimate_creation_cost(e["stakeUqor"].as_str().unwrap(), None).unwrap();
    assert_eq!(cost.burn_uqor, e["burnUqor"].as_str().unwrap());
    assert_eq!(cost.net_stake_uqor, e["netStakeUqor"].as_str().unwrap());
    assert_eq!(
        cost.total_required_uqor,
        e["totalRequiredUqor"].as_str().unwrap()
    );
    assert_eq!(cost.burn_rate, e["burnRate"].as_str().unwrap());
}

#[test]
fn merkle_matches_golden() {
    let g = golden();
    let m = &g["merkle"];
    let leaves: Vec<Vec<u8>> = m["leavesHex"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| hex::decode(h.as_str().unwrap()).unwrap())
        .collect();
    let opts = MerkleOptions::default();
    let root = binary_merkle_root(&leaves, opts);
    assert_eq!(hex::encode(&root), m["root"].as_str().unwrap());

    let proof = binary_merkle_proof(&leaves, 1, opts);
    let siblings_hex: Vec<String> = proof.siblings.iter().map(hex::encode).collect();
    let expected: Vec<String> = m["proofIndex1Siblings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert_eq!(siblings_hex, expected);

    // The withdrawal helper reproduces the same root + siblings.
    let w = assemble_withdrawal_proof(&leaves, 1, opts);
    assert_eq!(
        hex::encode(&w.withdrawals_root),
        m["root"].as_str().unwrap()
    );
    assert!(verify_binary_merkle_proof(
        &leaves[1], 1, &w.proof, &root, opts
    ));
}

#[test]
fn preset_defaults_match_golden() {
    let g = golden();
    let pd = &g["presetDefaults"];
    for (profile, key) in [
        (Profile::Defi, "defi"),
        (Profile::Gaming, "gaming"),
        (Profile::Nft, "nft"),
        (Profile::Enterprise, "enterprise"),
        (Profile::Custom, "custom"),
    ] {
        let d = preset_defaults(profile);
        let gd = &pd[key];
        assert_eq!(
            d.settlement.as_str(),
            gd["settlement"].as_str().unwrap(),
            "{key} settlement"
        );
        assert_eq!(
            d.sequencer.as_str(),
            gd["sequencer"].as_str().unwrap(),
            "{key} sequencer"
        );
        assert_eq!(d.da.as_str(), gd["da"].as_str().unwrap(), "{key} da");
        assert_eq!(
            d.proof_system.as_str(),
            gd["proofSystem"].as_str().unwrap(),
            "{key} proofSystem"
        );
        assert_eq!(
            d.gas_model.as_str(),
            gd["gasModel"].as_str().unwrap(),
            "{key} gasModel"
        );
        assert_eq!(
            d.vm_type.as_str(),
            gd["vmType"].as_str().unwrap(),
            "{key} vmType"
        );
        assert_eq!(
            d.block_time_ms,
            gd["blockTimeMs"].as_i64().unwrap(),
            "{key} blockTimeMs"
        );
        assert_eq!(
            d.max_tx_per_block,
            gd["maxTxPerBlock"].as_i64().unwrap(),
            "{key} maxTxPerBlock"
        );
        match gd.get("challengeWindowSecs").and_then(|v| v.as_i64()) {
            Some(w) => assert_eq!(
                d.challenge_window_secs,
                Some(w),
                "{key} challengeWindowSecs"
            ),
            None => assert_eq!(d.challenge_window_secs, None, "{key} challengeWindowSecs"),
        }
        match gd.get("challengeBondUqor").and_then(|v| v.as_str()) {
            Some(b) => assert_eq!(
                d.challenge_bond_uqor.as_deref(),
                Some(b),
                "{key} challengeBondUqor"
            ),
            None => assert_eq!(d.challenge_bond_uqor, None, "{key} challengeBondUqor"),
        }
    }
}

#[test]
fn msg_proto_bytes_match_golden() {
    let g = golden();
    let h = &g["msgProtoHex"];

    // MsgCreateRollup: creator "qor1creator", rollup "my-rollup", profile "defi",
    // vm "evm", stake 10_000_000_000.
    let create = CreateRollupInput {
        creator: "qor1creator".to_string(),
        rollup_id: "my-rollup".to_string(),
        profile: "defi".to_string(),
        vm_type: "evm".to_string(),
        stake_amount: 10_000_000_000,
    }
    .to_msg();
    assert_eq!(
        hex::encode(create.encode_to_vec_msg()),
        h["MsgCreateRollup"].as_str().unwrap()
    );

    // MsgPauseRollup: creator "qor1creator", rollup "r1", reason "x".
    let pause = PauseRollupInput {
        creator: "qor1creator".to_string(),
        rollup_id: "r1".to_string(),
        reason: "x".to_string(),
    }
    .to_msg();
    assert_eq!(
        hex::encode(pause.encode_to_vec_msg()),
        h["MsgPauseRollup"].as_str().unwrap()
    );

    // MsgSubmitBatch: sequencer "qor1seq", rollup "r", batchIndex 7,
    // stateRoot 010203, prevStateRoot 0405, txCount 42, dataHash 0909,
    // proof 08, withdrawalsRoot 070707.
    let submit = SubmitBatchInput {
        sequencer: "qor1seq".to_string(),
        rollup_id: "r".to_string(),
        batch_index: 7,
        state_root: vec![0x01, 0x02, 0x03],
        prev_state_root: vec![0x04, 0x05],
        tx_count: 42,
        data_hash: vec![0x09, 0x09],
        proof: vec![0x08],
        withdrawals_root: vec![0x07, 0x07, 0x07],
    }
    .to_msg();
    assert_eq!(
        hex::encode(submit.encode_to_vec_msg()),
        h["MsgSubmitBatch"].as_str().unwrap()
    );

    // MsgExecuteWithdrawal: submitter "qor1sub", rollup "r", batchIndex 3,
    // withdrawalIndex 1, recipient "qor1dest", denom "uqor", amount 500,
    // proof [01, 0202].
    let exec = ExecuteWithdrawalInput {
        submitter: "qor1sub".to_string(),
        rollup_id: "r".to_string(),
        batch_index: 3,
        withdrawal_index: 1,
        recipient: "qor1dest".to_string(),
        denom: "uqor".to_string(),
        amount: 500,
        proof: vec![vec![0x01], vec![0x02, 0x02]],
    }
    .to_msg();
    assert_eq!(
        hex::encode(exec.encode_to_vec_msg()),
        h["MsgExecuteWithdrawal"].as_str().unwrap()
    );
}
