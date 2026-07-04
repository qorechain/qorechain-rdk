//! Mirrors the TypeScript reference `test/vmtype.test.ts`: the QoreChain Native
//! VM-type alias, its wire value, its label, and the (now `native`) nft preset.

use qorechain_rdk::config::{
    is_vm_type, validate_rollup_config, vm_type_label, vm_type_wire_value, VmType, VM_TYPES,
};
use qorechain_rdk::presets::preset;
use qorechain_rdk::tx::codecs::RdkMsg;
use qorechain_rdk::tx::messages::CreateRollupInput;

#[test]
fn advertises_native_not_cosmwasm() {
    assert!(VM_TYPES.contains(&VmType::Native));
    assert!(!VM_TYPES.contains(&VmType::CosmWasm));
    // As advertised names.
    let names: Vec<&str> = VM_TYPES
        .iter()
        .map(|v| match v {
            VmType::Native => "native",
            other => other.as_str(),
        })
        .collect();
    assert_eq!(names, vec!["evm", "native", "svm", "custom"]);
}

#[test]
fn accepts_native_evm_svm_custom_and_the_cosmwasm_alias() {
    for v in ["native", "evm", "svm", "custom", "cosmwasm"] {
        assert!(is_vm_type(v), "{v} should be accepted");
    }
    assert!(!is_vm_type("wasm2"));
}

#[test]
fn maps_native_to_the_cosmwasm_wire_value_others_pass_through() {
    assert_eq!(vm_type_wire_value("native"), "cosmwasm");
    assert_eq!(vm_type_wire_value("cosmwasm"), "cosmwasm");
    assert_eq!(vm_type_wire_value("evm"), "evm");
    assert_eq!(vm_type_wire_value("svm"), "svm");
}

#[test]
fn labels_the_wasm_runtime_as_qorechain_native() {
    assert_eq!(vm_type_label("native"), "QoreChain Native");
    assert_eq!(vm_type_label("cosmwasm"), "QoreChain Native");
    assert_eq!(vm_type_label("evm"), "EVM");
    // The enum label agrees.
    assert_eq!(VmType::Native.label(), "QoreChain Native");
    assert_eq!(VmType::CosmWasm.label(), "QoreChain Native");
}

#[test]
fn emits_cosmwasm_on_the_wire_when_the_config_says_native() {
    let msg = CreateRollupInput {
        creator: "qor1creator".to_string(),
        rollup_id: "r".to_string(),
        profile: "nft".to_string(),
        vm_type: "native".to_string(),
        stake_amount: 1,
    }
    .to_msg();
    assert_eq!(msg.vm_type, "cosmwasm");
    // And it survives protobuf encoding (non-empty bytes).
    assert!(!msg.encode_to_vec_msg().is_empty());
}

#[test]
fn native_alias_deserializes_from_the_cosmwasm_wire_value() {
    // `native` and the legacy `cosmwasm` both parse to the QoreChain Native runtime.
    assert_eq!("native".parse::<VmType>().unwrap(), VmType::Native);
    assert_eq!("cosmwasm".parse::<VmType>().unwrap(), VmType::Native);
    assert!("wasm2".parse::<VmType>().is_err());
}

#[test]
fn validates_native_and_the_nft_preset_now_native() {
    let cfg = preset(qorechain_rdk::config::Profile::Nft)
        .set_rollup_id("r")
        .build()
        .unwrap();
    assert_eq!(cfg.vm_type, VmType::Native);
    assert!(validate_rollup_config(&cfg).valid);
}
