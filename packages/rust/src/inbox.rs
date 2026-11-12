//! Posted rollup data and the rollup inbox (chain v3.2.8+).
//!
//! `MsgPostRollupData` gives each post the next inbox sequence (from 1) and
//! extends the rollup's inbox accumulator:
//!
//! ```text
//! acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp(chain_id) | lp(rollup_id) | acc_{n-1}
//!                 | be64(n) | be64(height) | lp(poster) | SHA-256(data))
//! ```
//!
//! with `acc_0` 32 zero bytes and `lp` a 4-byte big-endian length prefix. A
//! batch of a based rollup sets `inbox_end` and carries as `data_hash` the
//! range commitment from the consumed position to `inbox_end`:
//!
//! ```text
//! range = SHA-256("qorechain/rdk/inbox-range/v1" | lp(chain_id) | lp(rollup_id)
//!                 | be64(from) | be64(to) | acc_from | acc_to)
//! ```
//!
//! The chain returns it too (`RestClient::get_inbox(rollup_id, inbox_end)`). A
//! native-DA batch of a rollup that is not based may carry `SHA-256(data)` of a
//! retained post as its `data_hash`.

use sha2::{Digest, Sha256};

const ACC_DOMAIN: &[u8] = b"qorechain/rdk/inbox/v1";
const RANGE_DOMAIN: &[u8] = b"qorechain/rdk/inbox-range/v1";

/// The accumulator of an inbox with no post: 32 zero bytes.
pub const EMPTY_INBOX_ACC: [u8; 32] = [0u8; 32];

fn update_lp(h: &mut Sha256, b: &[u8]) {
    h.update((b.len() as u32).to_be_bytes());
    h.update(b);
}

/// An accumulator value, with empty meaning [`EMPTY_INBOX_ACC`].
fn acc_or_empty(acc: &[u8]) -> &[u8] {
    if acc.is_empty() {
        &EMPTY_INBOX_ACC
    } else {
        acc
    }
}

/// SHA-256 of a post's payload: the hash a batch references.
pub fn posted_data_hash(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// One step of the inbox accumulator.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InboxAccumulateInput<'a> {
    /// The chain id.
    pub chain_id: &'a str,
    /// The rollup id.
    pub rollup_id: &'a str,
    /// The accumulator before this post (empty or [`EMPTY_INBOX_ACC`] for the
    /// first).
    pub prev_acc: &'a [u8],
    /// The post's inbox sequence.
    pub sequence: u64,
    /// The height of the block that included the post.
    pub height: u64,
    /// The poster address.
    pub poster: &'a str,
    /// SHA-256 of the payload ([`posted_data_hash`]).
    pub data_hash: &'a [u8],
}

/// One step of the inbox accumulator: what the chain stores after post
/// `sequence`.
pub fn inbox_accumulate(input: &InboxAccumulateInput<'_>) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(ACC_DOMAIN);
    update_lp(&mut h, input.chain_id.as_bytes());
    update_lp(&mut h, input.rollup_id.as_bytes());
    h.update(acc_or_empty(input.prev_acc));
    h.update(input.sequence.to_be_bytes());
    h.update(input.height.to_be_bytes());
    update_lp(&mut h, input.poster.as_bytes());
    h.update(input.data_hash);
    h.finalize().into()
}

/// The range a based batch consumes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InboxRangeInput<'a> {
    /// The chain id.
    pub chain_id: &'a str,
    /// The rollup id.
    pub rollup_id: &'a str,
    /// The consumed position (the sequence before the first post consumed).
    pub from: u64,
    /// `inbox_end`.
    pub to: u64,
    /// The accumulator at `from` (empty for 0).
    pub acc_from: &'a [u8],
    /// The accumulator at `to`.
    pub acc_to: &'a [u8],
}

/// The inbox range commitment a based batch carries as `data_hash`: the posts
/// after `from` (the consumed position) up to `to` (`inbox_end`).
pub fn inbox_range_hash(input: &InboxRangeInput<'_>) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(RANGE_DOMAIN);
    update_lp(&mut h, input.chain_id.as_bytes());
    update_lp(&mut h, input.rollup_id.as_bytes());
    h.update(input.from.to_be_bytes());
    h.update(input.to.to_be_bytes());
    h.update(acc_or_empty(input.acc_from));
    h.update(acc_or_empty(input.acc_to));
    h.finalize().into()
}
