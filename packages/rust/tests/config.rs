//! Integration tests for config validation, the matrix, presets, and the
//! manifest round-trip.

use qorechain_rdk::config::{validate_rollup_config, Profile, Sequencer, Settlement, VmType};
use qorechain_rdk::constants::Network;
use qorechain_rdk::manifest::{
    from_manifest, parse_manifest, stringify_manifest, to_manifest, ToManifestOptions,
};
use qorechain_rdk::presets::preset;

#[test]
fn preset_builds_and_validates() {
    let config = preset(Profile::Defi)
        .set_rollup_id("my-defi-rollup")
        .build()
        .unwrap();
    assert_eq!(config.profile, Profile::Defi);
    assert_eq!(config.settlement, Settlement::Zk);
    assert!(validate_rollup_config(&config).valid);
}

#[test]
fn matrix_violation_is_rejected() {
    // Force an incompatible proof system onto an optimistic preset.
    let mut config = preset(Profile::Nft).set_rollup_id("r").get();
    config.proof_system = qorechain_rdk::config::ProofSystem::Snark;
    let result = validate_rollup_config(&config);
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("not compatible")));
}

#[test]
fn based_settlement_requires_based_sequencer() {
    let mut config = preset(Profile::Gaming).set_rollup_id("r").get();
    config.sequencer = Sequencer::Dedicated;
    let result = validate_rollup_config(&config);
    assert!(!result.valid);
    assert!(result
        .errors
        .iter()
        .any(|e| e.contains("based settlement requires")));
}

#[test]
fn celestia_emits_warning() {
    let config = preset(Profile::Nft).set_rollup_id("r").get();
    let result = validate_rollup_config(&config);
    assert!(result.valid);
    assert!(result.warnings.iter().any(|w| w.contains("Celestia")));
}

#[test]
fn manifest_round_trip() {
    let config = preset(Profile::Defi)
        .set_rollup_id("round-trip")
        .set_vm_type(VmType::Evm)
        .build()
        .unwrap();
    let manifest = to_manifest(
        config.clone(),
        ToManifestOptions {
            network: Network::Testnet,
            chain_id: Some("qorechain-diana".to_string()),
            ..Default::default()
        },
    );

    let json = stringify_manifest(&manifest).unwrap();
    let parsed = parse_manifest(&json).unwrap();
    assert_eq!(parsed, manifest);
    assert_eq!(parsed.network, Network::Testnet);

    // Loading the manifest back into a builder yields the same config.
    let rebuilt = from_manifest(&parsed).unwrap().build().unwrap();
    assert_eq!(rebuilt, config);
}

#[test]
fn rejects_foreign_manifest() {
    let bad = r#"{"schema":"other","version":1,"network":"testnet","config":{}}"#;
    assert!(parse_manifest(bad).is_err());
}
