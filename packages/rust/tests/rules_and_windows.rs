//! The rule vectors are ported verbatim from the chain's own tests
//! (x/rdk/types/rollup_id_test.go and msgs_withdrawal_test.go at v3.2.3), so a
//! disagreement here is a disagreement with the chain, not with a guess.

use qorechain_rdk::challenge_window::{batch_challenge_window, ChainTip, WindowMode};
use qorechain_rdk::client::views::map_batch_view;
use qorechain_rdk::rules::{
    is_valid_rollup_id, rollup_id_error, withdrawal_errors, MAX_WITHDRAWAL_PROOF_DEPTH,
    ROLLUP_ESCROW_DENOM,
};
use serde_json::json;

#[test]
fn rollup_id_grammar_matches_the_chain() {
    let good = [
        "abc",
        "a1b",
        "0rollup",
        "my-rollup",
        "my_rollup",
        "my.rollup",
        "r--",
        "victim",
        &"a".repeat(64),
        "9.9.9",
    ];
    let bad = [
        "",
        "ab",
        &"a".repeat(65),
        "victim/x",
        "Victim",
        "ROLL",
        "-abc",
        ".abc",
        "_abc",
        "has space",
        "tab\tid",
        "nul\u{0}id",
        "new\nline",
        "é-rollup",
        "rollup✓",
        "a/b",
        "a\\b",
        "a:b",
        "a+b",
        "a%2fb",
    ];
    for id in good {
        assert!(
            is_valid_rollup_id(id),
            "{id:?} refused: {:?}",
            rollup_id_error(id)
        );
    }
    for id in bad {
        assert!(!is_valid_rollup_id(id), "{id:?} accepted");
    }
    // Length is in bytes, as the chain measures it.
    assert!(rollup_id_error(&format!("{}é", "a".repeat(63))).is_some());
}

const ADDR: &str = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h";

fn sib() -> Vec<u8> {
    vec![0xab; 32]
}

#[test]
fn withdrawal_rules_match_the_chain() {
    let ok = |rid: &str, denom: &str, amount: i64, proof: Vec<Vec<u8>>, sub: &str, rec: &str| {
        withdrawal_errors(sub, rid, rec, denom, amount, &proof)
    };
    assert!(ok(
        "roll-1",
        ROLLUP_ESCROW_DENOM,
        1,
        vec![sib(), sib()],
        ADDR,
        ADDR
    )
    .is_empty());
    assert!(!ok("roll-1", ROLLUP_ESCROW_DENOM, 1, vec![], "nope", ADDR).is_empty());
    assert!(!ok("", ROLLUP_ESCROW_DENOM, 1, vec![], ADDR, ADDR).is_empty());
    assert!(!ok("roll-1", ROLLUP_ESCROW_DENOM, 1, vec![], ADDR, "nope").is_empty());
    assert!(!ok("roll-1", "uatom", 1, vec![], ADDR, ADDR).is_empty());
    assert!(!ok("roll-1", ROLLUP_ESCROW_DENOM, 0, vec![], ADDR, ADDR).is_empty());
    assert!(!ok("roll-1", ROLLUP_ESCROW_DENOM, -5, vec![], ADDR, ADDR).is_empty());
    assert!(!ok(
        "roll-1",
        ROLLUP_ESCROW_DENOM,
        1,
        vec![vec![1, 2, 3]],
        ADDR,
        ADDR
    )
    .is_empty());
    assert!(!ok(
        "roll-1",
        ROLLUP_ESCROW_DENOM,
        1,
        vec![sib(); MAX_WITHDRAWAL_PROOF_DEPTH + 1],
        ADDR,
        ADDR
    )
    .is_empty());
    assert!(ok(
        "roll-1",
        ROLLUP_ESCROW_DENOM,
        1,
        vec![sib(); MAX_WITHDRAWAL_PROOF_DEPTH],
        ADDR,
        ADDR
    )
    .is_empty());
    // Ids from before v3.2.2 are not held to the grammar.
    assert!(ok("Legacy/ID", ROLLUP_ESCROW_DENOM, 1, vec![], ADDR, ADDR).is_empty());
}

#[test]
fn block_count_window_matches_the_chain_boundary() {
    // submitted_at is a BLOCK HEIGHT, not a timestamp.
    let batch = map_batch_view(&json!({ "batch_index": 0, "submitted_at": 1000 }));
    // 600 s => 100 blocks at the chain's 6 s assumption.
    let at = batch_challenge_window(
        &batch,
        600,
        ChainTip {
            height: 1100,
            time_secs: 0,
        },
    );
    assert_eq!(at.mode, WindowMode::Blocks);
    assert_eq!(at.window_blocks, Some(100));
    // At exactly the window the chain finalizes AND still accepts a challenge.
    assert!(at.finalizable && at.open);
    let past = batch_challenge_window(
        &batch,
        600,
        ChainTip {
            height: 1101,
            time_secs: 0,
        },
    );
    assert!(past.finalizable && !past.open);
}

#[test]
fn time_window_applies_when_the_submission_time_is_recorded() {
    let batch = map_batch_view(
        &json!({ "batch_index": 0, "submitted_at": 1000, "submitted_time": 1_700_000_000 }),
    );
    let w = batch_challenge_window(
        &batch,
        600,
        ChainTip {
            height: 999_999,
            time_secs: 1_700_000_500,
        },
    );
    assert_eq!(w.mode, WindowMode::Time);
    assert_eq!(w.seconds_remaining, Some(100));
    assert!(w.open && !w.finalizable);
}
