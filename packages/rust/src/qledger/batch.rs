//! Building qledger-v1 batches by the chain's admission rules (chain v3.2.8).
//!
//! A qledger-v1 batch with `inbox_end = end` is admitted when:
//!
//! 1. the submitter holds at least `min_submitter_bond` on the rollup and has
//!    fewer than 1,024 of its batches waiting for finality;
//! 2. `consumed < end <= head` (at least one entry);
//! 3. `end - consumed <= 64`;
//! 4. `end` is the head, or the commitment of post `end` is retained;
//! 5. a batch of fewer than 64 entries that stops before the head stops just
//!    before a post made in the last 20 blocks, or at a checkpoint (`end` a
//!    multiple of 64) whose next post is no longer retained;
//! 6. `data_hash` is the inbox range commitment from `consumed` to `end`, the
//!    first batch starts from the empty ledger root, and `state_root` is 32
//!    bytes.

use std::collections::HashMap;

use serde_json::Value;

use super::exec::{execute_qledger, QledgerEntry, QledgerEnv, QledgerResult};
use super::fraud::QLEDGER_MAX_BATCH_ENTRIES;
use super::smt::{qledger_empty_root, QledgerLedger};
use super::tx::{encode_qledger_deposit, QledgerVerifier, QLEDGER_DEPOSIT_POSTER_PREFIX};
use super::QledgerError;
use crate::client::rest::{RestClient, RestError};
use crate::constants::DEFAULT_MIN_SUBMITTER_BOND_UQOR;
use crate::inbox::{
    inbox_accumulate, inbox_range_hash, posted_data_hash, InboxAccumulateInput, InboxRangeInput,
};
use crate::tx::messages::SubmitBatchInput;
use crate::utils::bytes::{base64_to_bytes, decode_wire_bytes, hex_to_bytes};

/// A post younger than this many blocks may be left for the next batch.
pub const QLEDGER_FRESH_POST_BLOCKS: u64 = 20;
/// Most batches one submitter may have waiting for finality on a rollup.
pub const QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER: u64 = 1024;
/// Every post whose sequence is a multiple of this keeps its commitment until
/// a finalized batch covers it.
pub const QLEDGER_CHECKPOINT_INTERVAL: u64 = 64;
/// Share of a slashed submitter bond that is burned, in percent (the
/// challenger receives the rest).
pub const QLEDGER_SLASH_BURN_PERCENT: u64 = 50;

/// Whether `sequence` is a qledger-v1 checkpoint (a non-zero multiple of 64).
pub fn is_qledger_checkpoint(sequence: u64) -> bool {
    sequence != 0 && sequence.is_multiple_of(QLEDGER_CHECKPOINT_INTERVAL)
}

/// What the admission rules need to know about the inbox and the submitter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QledgerBatchFacts {
    /// The inbox's consumed position.
    pub consumed: u64,
    /// The inbox head.
    pub head: u64,
    /// The batch's `inbox_end`.
    pub end: u64,
    /// The submitter's bond on the rollup, in uqor.
    pub bond: u128,
    /// `min_submitter_bond`, in uqor.
    pub min_bond: u128,
    /// The submitter's batches waiting for finality.
    pub pending: u64,
    /// Whether the commitment of post `end` is retained (ignored when `end`
    /// is the head).
    pub end_retained: bool,
    /// Whether the commitment of post `end + 1` is retained (needed when
    /// `end` is before the head).
    pub next_retained: Option<bool>,
    /// Height of post `end + 1`, when retained.
    pub next_height: Option<u64>,
    /// The height the batch is expected to be included at. The chain judges
    /// the 20-block rule at inclusion, so pass the current height plus a
    /// margin for the time the transaction takes to land.
    pub inclusion_height: Option<u64>,
}

/// Every rule the batch range would break; empty when the chain admits it.
pub fn qledger_batch_errors(f: &QledgerBatchFacts) -> Vec<String> {
    let mut errors = Vec::new();
    if f.bond < f.min_bond {
        errors.push(format!(
            "the submitter holds {} uqor of bond, at least {} is needed",
            f.bond, f.min_bond
        ));
    }
    if f.pending >= QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER {
        errors.push(format!(
            "the submitter already has {} batches waiting for finality, at most {}",
            f.pending, QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER
        ));
    }
    let (consumed, head, end) = (f.consumed, f.head, f.end);
    if end <= consumed {
        errors.push(format!(
            "a batch consumes at least one inbox entry (consumed {consumed}, inbox_end {end})"
        ));
        return errors;
    }
    if end > head {
        errors.push(format!("inbox_end {end} is past the head {head}"));
    }
    let n = end - consumed;
    if n > QLEDGER_MAX_BATCH_ENTRIES {
        errors.push(format!(
            "a batch consumes at most {QLEDGER_MAX_BATCH_ENTRIES} inbox entries, this one {n}"
        ));
    }
    if end < head && !f.end_retained {
        errors.push(format!(
            "the commitment of post {end} is no longer retained: end the batch at the head or \
             at a retained post"
        ));
    }
    if n < QLEDGER_MAX_BATCH_ENTRIES && end < head {
        let checkpoint_stop = is_qledger_checkpoint(end) && f.next_retained == Some(false);
        let fresh_stop = f.next_retained != Some(false)
            && matches!(
                (f.next_height, f.inclusion_height),
                (Some(nh), Some(ih)) if nh.saturating_add(QLEDGER_FRESH_POST_BLOCKS) > ih
            );
        if !checkpoint_stop && !fresh_stop {
            errors.push(format!(
                "a batch of fewer than {QLEDGER_MAX_BATCH_ENTRIES} entries consumes every post \
                 older than {QLEDGER_FRESH_POST_BLOCKS} blocks: post {} must be in it",
                end + 1
            ));
        }
    }
    errors
}

/// The `end` a submitter should choose (the chain's recommended logic): a
/// full batch of 64 or the head when that position is retained, otherwise the
/// next checkpoint (after a long idle period, when only checkpoints kept their
/// commitments). `None` when nothing is waiting.
///
/// `retained(x)`: whether the commitment of post `x` is retained
/// (`RestClient::get_inbox(rollup_id, x)` serves a non-empty
/// `range_data_hash`).
pub fn choose_qledger_batch_end<E>(
    consumed: u64,
    head: u64,
    mut retained: impl FnMut(u64) -> Result<bool, E>,
) -> Result<Option<u64>, E> {
    if head <= consumed {
        return Ok(None);
    }
    let want = head.min(consumed.saturating_add(QLEDGER_MAX_BATCH_ENTRIES));
    if want == head || retained(want)? {
        return Ok(Some(want));
    }
    Ok(Some(
        (consumed / QLEDGER_CHECKPOINT_INTERVAL + 1) * QLEDGER_CHECKPOINT_INTERVAL,
    ))
}

/// The inbox accumulator after `entries`, starting from `acc_from` (empty for
/// the empty inbox) at sequence `from`.
pub fn qledger_accumulate(
    chain_id: &str,
    rollup_id: &str,
    from: u64,
    acc_from: &[u8],
    entries: &[QledgerEntry],
) -> Vec<u8> {
    let mut acc = acc_from.to_vec();
    for (i, e) in entries.iter().enumerate() {
        let data_hash = posted_data_hash(&e.payload);
        acc = inbox_accumulate(&InboxAccumulateInput {
            chain_id,
            rollup_id,
            prev_acc: &acc,
            sequence: from + i as u64 + 1,
            height: e.height,
            poster: &e.poster,
            data_hash: &data_hash,
        })
        .to_vec();
    }
    acc
}

/// Which inbox entries to read back from the chain.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QledgerFetchInput<'a> {
    /// The chain id.
    pub chain_id: &'a str,
    /// The rollup id.
    pub rollup_id: &'a str,
    /// The consumed position: entries `from + 1 ..= to` are read.
    pub from: u64,
    /// The last entry read.
    pub to: u64,
    /// The inbox accumulator at `from` (empty for 0).
    pub acc_from: &'a [u8],
}

fn attrs(ev: &Value) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for a in ev
        .get("attributes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let s = |v: Option<&Value>| match v {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Null) | None => String::new(),
            Some(other) => other.to_string(),
        };
        out.insert(s(a.get("key")), s(a.get("value")));
    }
    out
}

fn height_of(tx: &Value) -> u64 {
    match tx.get("height") {
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        _ => 0,
    }
}

fn events(tx: &Value) -> impl Iterator<Item = &Value> {
    tx.get("events")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn norm_hex(s: &str) -> String {
    s.trim_start_matches("0x").to_ascii_lowercase()
}

/// The inbox entries `from + 1 ..= to` of a qledger-v1 rollup, read back from
/// the transactions that posted them (the chain keeps only commitments; the
/// bytes stay in block history). Posts come from `MsgPostRollupData`
/// (`rdk_data_posted` events), deposits from `rdk_rollup_deposit` events.
/// The entries are checked against the chain's inbox accumulator after post
/// `to` (its posted-data commitment, or the head accumulator when `to` is the
/// head and that commitment is pruned) and refused when they cannot be.
/// Needs a node with transaction indexing on.
pub fn fetch_qledger_entries(
    rest: &RestClient,
    input: &QledgerFetchInput<'_>,
) -> Result<Vec<QledgerEntry>, QledgerError> {
    let (from, to, rollup_id) = (input.from, input.to, input.rollup_id);
    let mut by_seq: HashMap<u64, QledgerEntry> = HashMap::new();
    let in_range = |a: &HashMap<String, String>| -> Option<u64> {
        if a.get("rollup_id").map(String::as_str) != Some(rollup_id) {
            return None;
        }
        let seq: u64 = a.get("sequence")?.parse().ok()?;
        (seq > from && seq <= to).then_some(seq)
    };

    for tx in rest.search_txs(&format!("rdk_data_posted.rollup_id='{rollup_id}'"))? {
        let height = height_of(&tx);
        let msgs: Vec<&Value> = tx
            .pointer("/tx/body/messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|m| {
                m.get("@type").and_then(Value::as_str)
                    == Some("/qorechain.rdk.v1.MsgPostRollupData")
            })
            .collect();
        for ev in events(&tx) {
            if ev.get("type").and_then(Value::as_str) != Some("rdk_data_posted") {
                continue;
            }
            let a = attrs(ev);
            let Some(seq) = in_range(&a) else { continue };
            let want_hash = norm_hex(a.get("data_hash").map_or("", String::as_str));
            let poster = a.get("poster").cloned().unwrap_or_default();
            let payload = msgs.iter().find_map(|m| {
                let data =
                    base64_to_bytes(m.get("data").and_then(Value::as_str).unwrap_or("")).ok()?;
                let same_poster = m.get("poster").and_then(Value::as_str) == Some(poster.as_str());
                (same_poster && hex::encode(posted_data_hash(&data)) == want_hash).then_some(data)
            });
            let Some(payload) = payload else {
                return Err(QledgerError::Fetch(format!(
                    "post {seq} is in transaction {} but its payload could not be matched",
                    tx.get("txhash").and_then(Value::as_str).unwrap_or("?")
                )));
            };
            by_seq.insert(
                seq,
                QledgerEntry {
                    height,
                    poster,
                    payload,
                },
            );
        }
    }

    for tx in rest.search_txs(&format!("rdk_rollup_deposit.rollup_id='{rollup_id}'"))? {
        let height = height_of(&tx);
        for ev in events(&tx) {
            if ev.get("type").and_then(Value::as_str) != Some("rdk_rollup_deposit") {
                continue;
            }
            let a = attrs(ev);
            let Some(seq) = in_range(&a) else { continue };
            let bad =
                |what: &str| QledgerError::Fetch(format!("deposit {seq} has an unreadable {what}"));
            let amount: u64 = a
                .get("amount")
                .map(|s| s.trim_end_matches("uqor"))
                .unwrap_or("")
                .parse()
                .map_err(|_| bad("amount"))?;
            let account: [u8; 32] = hex_to_bytes(a.get("account").map_or("", String::as_str))
                .ok()
                .and_then(|b| b.try_into().ok())
                .ok_or_else(|| bad("account"))?;
            by_seq.insert(
                seq,
                QledgerEntry {
                    height,
                    poster: format!(
                        "{QLEDGER_DEPOSIT_POSTER_PREFIX}{}",
                        a.get("depositor").map_or("", String::as_str)
                    ),
                    payload: encode_qledger_deposit(&account, amount),
                },
            );
        }
    }

    let mut entries = Vec::new();
    for s in from + 1..=to {
        let e = by_seq.remove(&s).ok_or_else(|| {
            QledgerError::Fetch(format!(
                "inbox entry {s} of rollup {rollup_id} was not found in the node's transaction \
                 index"
            ))
        })?;
        entries.push(e);
    }

    // Check the bytes against the chain's inbox accumulator after post `to`:
    // its posted-data commitment, or the head accumulator once that is pruned.
    if to > from {
        let ours = qledger_accumulate(input.chain_id, rollup_id, from, input.acc_from, &entries);
        let chain_acc = match rest.get_posted_data(rollup_id, to) {
            Ok(p) => p.inbox_acc,
            Err(RestError::Status { status: 404, .. }) => {
                let inbox = rest.get_inbox(rollup_id, 0)?;
                if inbox.head_sequence.max(0) as u64 != to {
                    return Err(QledgerError::Fetch(format!(
                        "the chain no longer retains the commitment of post {to}, so the \
                         entries cannot be checked"
                    )));
                }
                inbox.head_acc
            }
            Err(e) => return Err(e.into()),
        };
        if chain_acc.is_empty() || decode_wire_bytes(&chain_acc) != ours {
            return Err(QledgerError::Fetch(format!(
                "the fetched entries do not match the chain's inbox accumulator at post {to}"
            )));
        }
    }
    Ok(entries)
}

/// What [`plan_qledger_batch`] needs.
#[derive(Clone, Copy)]
pub struct QledgerPlanInput<'a> {
    /// The chain id.
    pub chain_id: &'a str,
    /// The rollup id.
    pub rollup_id: &'a str,
    /// The submitter's address.
    pub submitter: &'a str,
    /// The state after the rollup's latest batch, or an empty ledger before
    /// the first.
    pub ledger: &'a QledgerLedger,
    /// Checks each transaction's ML-DSA-44 signature.
    pub verifier: &'a dyn QledgerVerifier,
    /// Blocks added to the current height for the 20-block rule (default 5).
    pub inclusion_margin: Option<u64>,
}

impl std::fmt::Debug for QledgerPlanInput<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QledgerPlanInput")
            .field("chain_id", &self.chain_id)
            .field("rollup_id", &self.rollup_id)
            .field("submitter", &self.submitter)
            .field("inclusion_margin", &self.inclusion_margin)
            .finish_non_exhaustive()
    }
}

/// A qledger-v1 batch ready for `RdkTxClient::submit_batch`, with what it
/// settles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerBatchPlan {
    /// Pass to `submit_batch` (the client fills in the sequencer).
    pub input: SubmitBatchInput,
    /// The entries consumed.
    pub entries: Vec<QledgerEntry>,
    /// The execution result (withdrawals to pay later).
    pub result: QledgerResult,
    /// The ledger after the batch: the parent state of the next one.
    pub ledger: QledgerLedger,
}

/// Whether the chain retains the commitment of post `x` (`head` always is).
fn retained(rest: &RestClient, rollup_id: &str, head: u64, x: u64) -> Result<bool, RestError> {
    Ok(x == head || !rest.get_inbox(rollup_id, x)?.range_data_hash.is_empty())
}

/// `(next_retained, next_height)` of post `end + 1` when `end` is before the
/// head; a 404 from the posted-data query reads as not retained.
fn next_post(
    rest: &RestClient,
    rollup_id: &str,
    head: u64,
    end: u64,
) -> Result<(Option<bool>, Option<u64>), RestError> {
    if end >= head {
        return Ok((None, None));
    }
    match rest.get_posted_data(rollup_id, end + 1) {
        Ok(p) => Ok((Some(true), Some(p.height.max(0) as u64))),
        Err(RestError::Status { status: 404, .. }) => Ok((Some(false), None)),
        Err(e) => Err(e),
    }
}

/// The admission facts of a qledger-v1 batch ending at `end`, read from the
/// chain (the shared part of [`plan_qledger_batch`] and the client's
/// `submit_batch` checks).
pub(crate) fn read_qledger_batch_facts(
    rest: &RestClient,
    rollup_id: &str,
    submitter: &str,
    consumed: u64,
    head: u64,
    end: u64,
    inclusion_margin: u64,
) -> Result<QledgerBatchFacts, RestError> {
    let params = rest.get_params()?;
    let bond = rest.get_submitter_bond(rollup_id, submitter)?;
    let min_bond = params
        .min_submitter_bond
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_MIN_SUBMITTER_BOND_UQOR as u128);
    let (next_retained, next_height) = next_post(rest, rollup_id, head, end)?;
    let end_retained = end <= head && retained(rest, rollup_id, head, end)?;
    let inclusion_height = rest.get_latest_height()? + inclusion_margin;
    Ok(QledgerBatchFacts {
        consumed,
        head,
        end,
        bond: bond.amount.parse().unwrap_or(0),
        min_bond,
        pending: bond.pending.max(0) as u64,
        end_retained,
        next_retained,
        next_height,
        inclusion_height: Some(inclusion_height),
    })
}

/// Plan the next qledger-v1 batch of a rollup from the chain: choose `end` by
/// the admission rules, fetch and verify the entries, execute them on
/// `input.ledger` (the state after the rollup's latest batch, or an empty
/// ledger before the first), and return the batch. Fails with the chain's
/// reason when no batch can be admitted now (no bond, too many pending,
/// nothing to consume).
///
/// The submitter keeps `plan.ledger` as the parent state of its next batch
/// once this one settles.
pub fn plan_qledger_batch(
    rest: &RestClient,
    input: &QledgerPlanInput<'_>,
) -> Result<QledgerBatchPlan, QledgerError> {
    let (chain_id, rollup_id) = (input.chain_id, input.rollup_id);
    let rollup = rest.get_rollup(rollup_id)?;
    if rollup.execution_vm != "qledger-v1" {
        return Err(QledgerError::InvalidInput(format!(
            "rollup {rollup_id} is not a qledger-v1 rollup"
        )));
    }
    let inbox = rest.get_inbox(rollup_id, 0)?;
    let consumed = inbox.consumed_sequence.max(0) as u64;
    let head = inbox.head_sequence.max(0) as u64;
    let Some(end) =
        choose_qledger_batch_end(consumed, head, |x| retained(rest, rollup_id, head, x))?
    else {
        return Err(QledgerError::Refused(format!(
            "rollup {rollup_id} has nothing to settle: its inbox is fully consumed"
        )));
    };
    let facts = read_qledger_batch_facts(
        rest,
        rollup_id,
        input.submitter,
        consumed,
        head,
        end,
        input.inclusion_margin.unwrap_or(5),
    )?;
    let errors = qledger_batch_errors(&facts);
    if !errors.is_empty() {
        return Err(QledgerError::Refused(format!(
            "no qledger-v1 batch can be admitted now: {}",
            errors.join("; ")
        )));
    }

    let acc_from = decode_wire_bytes(&inbox.consumed_acc);
    let entries = fetch_qledger_entries(
        rest,
        &QledgerFetchInput {
            chain_id,
            rollup_id,
            from: consumed,
            to: end,
            acc_from: &acc_from,
        },
    )?;
    let acc_to = qledger_accumulate(chain_id, rollup_id, consumed, &acc_from, &entries);
    let data_hash = inbox_range_hash(&InboxRangeInput {
        chain_id,
        rollup_id,
        from: consumed,
        to: end,
        acc_from: &acc_from,
        acc_to: &acc_to,
    });
    let served = rest.get_inbox(rollup_id, end)?.range_data_hash;
    if !served.is_empty() && decode_wire_bytes(&served) != data_hash {
        return Err(QledgerError::Fetch(
            "the fetched entries do not hash to the chain's inbox range commitment".to_string(),
        ));
    }

    let latest = match rest.get_latest_batch(rollup_id) {
        Ok(b) => Some(b),
        Err(RestError::Status { status: 404, .. }) => None,
        Err(e) => return Err(e.into()),
    };
    let prev_state_root = match &latest {
        Some(b) => decode_wire_bytes(&b.state_root),
        None => qledger_empty_root().to_vec(),
    };
    let ours = input.ledger.root();
    if ours.as_slice() != prev_state_root.as_slice() {
        return Err(QledgerError::InvalidInput(format!(
            "the ledger you passed has root {}, but the rollup's latest state root is {}",
            hex::encode(ours),
            hex::encode(&prev_state_root)
        )));
    }
    let mut ledger = input.ledger.clone();
    let env = QledgerEnv {
        chain_id,
        rollup_id,
        verifier: input.verifier,
    };
    let result = execute_qledger(&env, &mut ledger, &entries)?;
    Ok(QledgerBatchPlan {
        input: SubmitBatchInput {
            rollup_id: rollup_id.to_string(),
            batch_index: latest.map_or(0, |b| b.batch_index.max(0) as u64 + 1),
            prev_state_root,
            state_root: result.state_root.to_vec(),
            tx_count: entries.len() as u64,
            data_hash: data_hash.to_vec(),
            withdrawals_root: result.withdrawals_root.clone(),
            inbox_end: end,
            ..Default::default()
        },
        entries,
        result,
        ledger,
    })
}
