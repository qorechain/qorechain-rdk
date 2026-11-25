//! Watching qledger-v1 rollups.
//!
//! The chain decides a challenge against a qledger-v1 batch by re-executing the
//! inbox entries the batch consumed from its parent state and comparing the
//! state and withdrawals roots it published ([`check_qledger_fraud`]). A
//! qledger-v1 state root is the root of the account tree, not the canonical
//! transition root other optimistic rollups publish
//! ([`crate::transition::batch_transition_root`]), so judging a qledger-v1
//! batch by the transition-root rule reports every honest batch as invalid, and
//! a transition-root fraud proof ([`crate::transition::fraud_proof`]) is
//! dismissed by the chain.
//!
//! [`qledger_validator`] applies the chain's own qledger-v1 rule: it rebuilds
//! the parent state by replaying the rollup's earlier batches, reads the
//! entries the batch consumed, builds the fraud proof a challenger would send,
//! and decides it with [`check_qledger_fraud`], the same decision the chain
//! makes. A batch it rejects is one the proof from
//! [`qledger_fraud_proof_for_batch`] wins.

use std::fmt;
use std::sync::Arc;

use super::batch::{fetch_qledger_entries, QledgerFetchInput};
use super::exec::{execute_qledger, QledgerEntry, QledgerEnv, QledgerResult};
use super::fraud::{build_qledger_fraud_proof, check_qledger_fraud, QledgerClaim};
use super::smt::{qledger_empty_root, QledgerLedger};
use super::tx::{QledgerVerifier, MLDSA44_VERIFIER};
use super::QledgerError;
use crate::client::views::BatchView;
use crate::client::{RdkClient, RestClient};
use crate::inbox::EMPTY_INBOX_ACC;
use crate::utils::bytes::decode_wire_bytes;

/// Reads the inbox entries a batch consumed: sequences `from + 1 ..= to` of
/// the input, where `acc_from` is the inbox accumulator after entry `from`
/// (the batch's start).
pub type QledgerEntryReader =
    Box<dyn FnMut(&QledgerFetchInput<'_>) -> Result<Vec<QledgerEntry>, QledgerError> + Send>;

/// Parent states a [`QledgerJudge`] keeps by default.
const DEFAULT_MAX_CACHED_STATES: usize = 32;

/// How a [`QledgerJudge`] reads entries and how much it keeps.
#[derive(Default)]
pub struct QledgerValidatorOptions {
    /// Where the entries come from. Defaults to [`fetch_qledger_entries`],
    /// which reads them back from the node's transaction index and checks them
    /// against the chain's inbox accumulator. Supply your own to read from an
    /// archive of posts you keep, for example once the node has pruned old
    /// transactions.
    pub read_entries: Option<QledgerEntryReader>,
    /// How many parent states to keep in memory (default 32, at least 2). Older
    /// ones are rebuilt by replay; the empty ledger is always kept.
    pub max_cached_states: Option<usize>,
    /// Checks each transaction's ML-DSA-44 signature (default
    /// [`MLDSA44_VERIFIER`], the check the chain applies).
    pub verifier: Option<Box<dyn QledgerVerifier + Send>>,
}

impl fmt::Debug for QledgerValidatorOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QledgerValidatorOptions")
            .field("read_entries", &self.read_entries.as_ref().map(|_| ".."))
            .field("max_cached_states", &self.max_cached_states)
            .finish_non_exhaustive()
    }
}

/// How a qledger-v1 batch fares under the chain's fraud rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerJudgement {
    /// `true` when a challenge against the batch would be dismissed.
    pub valid: bool,
    /// What an honest batch over the same entries publishes.
    pub honest: QledgerResult,
    /// For an invalid batch: the encoded proof that wins `challenge_batch`.
    pub proof: Option<Vec<u8>>,
}

/// Judges the batches of one qledger-v1 rollup, keeping the honest ledger
/// after each batch it accepts so the next batch is judged without a full
/// replay. Use one judge per rollup.
pub struct QledgerJudge {
    chain_id: String,
    rollup_id: String,
    rest: RestClient,
    read: QledgerEntryReader,
    verifier: Box<dyn QledgerVerifier + Send>,
    max_states: usize,
    empty_root: Vec<u8>,
    /// Honest ledgers by state root, oldest first.
    states: Vec<(Vec<u8>, Arc<QledgerLedger>)>,
}

impl fmt::Debug for QledgerJudge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QledgerJudge")
            .field("chain_id", &self.chain_id)
            .field("rollup_id", &self.rollup_id)
            .field("max_states", &self.max_states)
            .field("cached_states", &self.states.len())
            .finish_non_exhaustive()
    }
}

impl QledgerJudge {
    /// A judge for `rollup_id` on `client`'s network. The judge keeps its own
    /// handle on `client.rest`.
    pub fn new(
        client: &RdkClient,
        rollup_id: impl Into<String>,
        options: QledgerValidatorOptions,
    ) -> Self {
        let rest = client.rest.clone();
        let read = options.read_entries.unwrap_or_else(|| {
            let rest = rest.clone();
            Box::new(move |input: &QledgerFetchInput<'_>| fetch_qledger_entries(&rest, input))
        });
        let empty_root = qledger_empty_root().to_vec();
        QledgerJudge {
            chain_id: client.network.chain_id.clone(),
            rollup_id: rollup_id.into(),
            rest,
            read,
            verifier: options
                .verifier
                .unwrap_or_else(|| Box::new(MLDSA44_VERIFIER)),
            max_states: options
                .max_cached_states
                .unwrap_or(DEFAULT_MAX_CACHED_STATES)
                .max(2),
            states: vec![(empty_root.clone(), Arc::new(QledgerLedger::new()))],
            empty_root,
        }
    }

    /// Decide `batch` as the chain would decide a challenge against it.
    ///
    /// Fails when the batch cannot be decided: its entries cannot be read, they
    /// do not belong to the batch ([`QledgerError::NotApplicable`]), or the
    /// batch builds on a state root no honest replay of the rollup reaches.
    pub fn judge(&mut self, batch: &BatchView) -> Result<QledgerJudgement, QledgerError> {
        let parent = self.ledger_at(&decode_wire_bytes(&batch.prev_state_root))?;
        self.judge_on(&parent, batch)
    }

    fn state(&self, root: &[u8]) -> Option<&Arc<QledgerLedger>> {
        self.states
            .iter()
            .find(|(r, _)| r.as_slice() == root)
            .map(|(_, l)| l)
    }

    fn remember(&mut self, root: Vec<u8>, ledger: QledgerLedger) {
        self.states.retain(|(r, _)| *r != root);
        self.states.push((root, Arc::new(ledger)));
        while self.states.len() > self.max_states {
            let Some(oldest) = self.states.iter().position(|(r, _)| *r != self.empty_root) else {
                break;
            };
            self.states.remove(oldest);
        }
    }

    /// The inbox accumulator after entry `seq` (posted data is numbered from 1).
    fn acc_after(&self, seq: u64) -> Result<Vec<u8>, QledgerError> {
        if seq == 0 {
            return Ok(EMPTY_INBOX_ACC.to_vec());
        }
        let posted = self.rest.get_posted_data(&self.rollup_id, seq)?;
        Ok(decode_wire_bytes(&posted.inbox_acc))
    }

    fn judge_on(
        &mut self,
        parent: &QledgerLedger,
        batch: &BatchView,
    ) -> Result<QledgerJudgement, QledgerError> {
        let start = batch.inbox_start.max(0) as u64;
        let end = batch.inbox_end.max(0) as u64;
        let acc_from = self.acc_after(start)?;
        let entries = (self.read)(&QledgerFetchInput {
            chain_id: &self.chain_id,
            rollup_id: &self.rollup_id,
            from: start,
            to: end,
            acc_from: &acc_from,
        })?;
        let env = QledgerEnv {
            chain_id: &self.chain_id,
            rollup_id: &self.rollup_id,
            verifier: &*self.verifier,
        };
        let (proof, honest) = build_qledger_fraud_proof(&env, parent, &acc_from, &entries)?;
        // The chain's own decision on that proof. It fails when the entries do
        // not belong to this batch, which leaves the batch undecided rather
        // than invalid.
        let claim = QledgerClaim {
            inbox_start: start,
            inbox_end: end,
            data_hash: decode_wire_bytes(&batch.data_hash),
            prev_state_root: decode_wire_bytes(&batch.prev_state_root),
            state_root: decode_wire_bytes(&batch.state_root),
            withdrawals_root: decode_wire_bytes(&batch.withdrawals_root),
        };
        if check_qledger_fraud(&env, &claim, &proof)? {
            return Ok(QledgerJudgement {
                valid: false,
                honest,
                proof: Some(proof),
            });
        }
        let mut next = parent.clone();
        execute_qledger(&env, &mut next, &entries)?;
        self.remember(next.root().to_vec(), next);
        Ok(QledgerJudgement {
            valid: true,
            honest,
            proof: None,
        })
    }

    /// The honest ledger whose root is `root`, replaying the rollup's batches
    /// in order from the empty ledger when it is not already known. Only a
    /// batch that reproduces from a known state is followed, so a root that no
    /// honest replay reaches is refused: the batch that introduced it is the
    /// one to challenge.
    fn ledger_at(&mut self, root: &[u8]) -> Result<Arc<QledgerLedger>, QledgerError> {
        if let Some(known) = self.state(root) {
            return Ok(known.clone());
        }
        let mut batches: Vec<BatchView> = self
            .rest
            .list_batches(&self.rollup_id)?
            .into_iter()
            .filter(|b| b.status != "rejected")
            .collect();
        batches.sort_by_key(|b| b.batch_index);
        for b in &batches {
            if self.state(&decode_wire_bytes(&b.state_root)).is_some() {
                continue;
            }
            let Some(parent) = self.state(&decode_wire_bytes(&b.prev_state_root)).cloned() else {
                continue;
            };
            self.judge_on(&parent, b)?;
            if let Some(found) = self.state(root) {
                return Ok(found.clone());
            }
        }
        Err(QledgerError::InvalidInput(format!(
            "no honest replay of {} reaches state root {}; a batch before this one published \
             it, and that batch is the one a challenge wins against",
            self.rollup_id,
            hex::encode(root)
        )))
    }
}

/// A validity predicate for a qledger-v1 rollup: `Ok(true)` exactly when a
/// challenge against the batch would be dismissed, `Ok(false)` when the
/// chain would uphold one. It returns an error when it cannot decide, for
/// example when the batch builds on a state no honest replay reaches; report
/// that rather than flagging the batch.
///
/// The predicate owns a [`QledgerJudge`], so it is `Send + 'static` and can be
/// moved onto a polling thread like the callbacks of
/// [`crate::monitor::watch_rollup`].
pub fn qledger_validator(
    client: &RdkClient,
    rollup_id: impl Into<String>,
    options: QledgerValidatorOptions,
) -> impl FnMut(&BatchView) -> Result<bool, QledgerError> + Send + 'static {
    let mut judge = QledgerJudge::new(client, rollup_id, options);
    move |batch: &BatchView| Ok(judge.judge(batch)?.valid)
}

/// The qledger-v1 fraud proof that wins a challenge against `batch`, or `None`
/// when the batch is right (a challenge would be dismissed and forfeit its
/// bond). The proof has already been decided with [`check_qledger_fraud`], the
/// rule the chain applies.
pub fn qledger_fraud_proof_for_batch(
    client: &RdkClient,
    rollup_id: impl Into<String>,
    batch: &BatchView,
    options: QledgerValidatorOptions,
) -> Result<Option<Vec<u8>>, QledgerError> {
    Ok(QledgerJudge::new(client, rollup_id, options)
        .judge(batch)?
        .proof)
}
