//! qledger-v1 execution: what a batch's state root and withdrawals root must
//! be for the inbox entries it consumes. The chain re-runs exactly this in a
//! fraud proof, so a submitter that publishes anything else loses its bond.
//!
//! Entries that do not parse, carry a bad signature, the wrong nonce, a zero
//! amount, more than the balance, or a non-canonical recipient are no-ops: an
//! open inbox must accept anything without making a batch invalid.

use bech32::primitives::decode::CheckedHrpstring;
use bech32::{Bech32, Hrp};
use sha2::{Digest, Sha256};

use super::smt::QledgerState;
use super::tx::{
    decode_qledger_deposit, decode_qledger_tx, verify_qledger_tx, QledgerVerifier,
    QLEDGER_DEPOSIT_POSTER_PREFIX, QLEDGER_KIND_TRANSFER, QLEDGER_KIND_WITHDRAW,
};
use super::QledgerError;
use crate::utils::qorehash::qorehash;

/// The denom every qledger-v1 withdrawal pays.
pub const QLEDGER_WITHDRAWAL_DENOM: &str = "uqor";

/// The reserved state slot holding the rollup's next withdrawal index (in its
/// balance): `SHA-256("qledger/v1/withdrawal-counter")`. Withdrawal indices are
/// global to the rollup.
pub fn qledger_withdrawal_counter_id() -> [u8; 32] {
    Sha256::digest(b"qledger/v1/withdrawal-counter").into()
}

/// What execution needs besides the state: the chain and rollup every
/// signature is bound to, and the signature check.
#[derive(Clone, Copy)]
pub struct QledgerEnv<'a> {
    /// The chain id.
    pub chain_id: &'a str,
    /// The rollup id.
    pub rollup_id: &'a str,
    /// Checks each transaction's ML-DSA-44 signature.
    pub verifier: &'a dyn QledgerVerifier,
}

impl std::fmt::Debug for QledgerEnv<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QledgerEnv")
            .field("chain_id", &self.chain_id)
            .field("rollup_id", &self.rollup_id)
            .finish_non_exhaustive()
    }
}

/// One inbox entry a batch consumes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerEntry {
    /// The height of the block that included the post.
    pub height: u64,
    /// The poster address, or `"deposit:" + depositor` for a deposit.
    pub poster: String,
    /// The posted bytes.
    pub payload: Vec<u8>,
}

/// One withdrawal a batch commits, at its global index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerWithdrawal {
    /// The rollup-wide withdrawal index.
    pub index: u64,
    /// The `qor1` recipient.
    pub recipient: String,
    /// The amount, in uqor.
    pub amount: u64,
}

/// What a batch must publish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerResult {
    /// The state root after the batch.
    pub state_root: [u8; 32],
    /// The withdrawals the batch commits.
    pub withdrawals: Vec<QledgerWithdrawal>,
    /// Empty when the batch has no withdrawal.
    pub withdrawals_root: Vec<u8>,
}

/// Whether `s` is a `qor1` account address in canonical (lowercase,
/// re-encoding) form.
pub fn is_canonical_qor_address(s: &str) -> bool {
    let Ok(checked) = CheckedHrpstring::new::<Bech32>(s) else {
        return false;
    };
    if checked.hrp().as_str() != "qor" {
        return false;
    }
    let data: Vec<u8> = checked.byte_iter().collect();
    if data.is_empty() || data.len() > 255 {
        return false;
    }
    let Ok(hrp) = Hrp::parse("qor") else {
        return false;
    };
    bech32::encode_lower::<Bech32>(hrp, &data).is_ok_and(|e| e == s)
}

/// Apply `entries` to `state` in order and return the roots the batch must
/// publish. Fails only when `state` cannot serve an account (a partial tree
/// missing a witness).
pub fn execute_qledger<S: QledgerState + ?Sized>(
    env: &QledgerEnv<'_>,
    state: &mut S,
    entries: &[QledgerEntry],
) -> Result<QledgerResult, QledgerError> {
    let counter = qledger_withdrawal_counter_id();
    let mut withdrawals = Vec::new();
    for e in entries {
        if e.poster.starts_with(QLEDGER_DEPOSIT_POSTER_PREFIX) {
            let Some((account, amount)) = decode_qledger_deposit(&e.payload) else {
                continue;
            };
            if account == counter {
                continue;
            }
            let (bal, nonce) = state.get(&account)?;
            let Some(sum) = bal.checked_add(amount) else {
                continue;
            };
            state.set(&account, sum, nonce)?;
            continue;
        }
        let Some(tx) = decode_qledger_tx(&e.payload) else {
            continue;
        };
        if !verify_qledger_tx(&tx, env.chain_id, env.rollup_id, env.verifier) {
            continue;
        }
        let from = tx.from_account();
        let (bal, nonce) = state.get(&from)?;
        if tx.nonce != nonce || tx.amount == 0 || bal < tx.amount || nonce == u64::MAX {
            continue;
        }
        match tx.kind {
            QLEDGER_KIND_TRANSFER => {
                if tx.to == counter {
                    continue;
                }
                if tx.to == from {
                    state.set(&from, bal, nonce + 1)?;
                    continue;
                }
                let (tb, tn) = state.get(&tx.to)?;
                let Some(sum) = tb.checked_add(tx.amount) else {
                    continue;
                };
                state.set(&from, bal - tx.amount, nonce + 1)?;
                state.set(&tx.to, sum, tn)?;
            }
            QLEDGER_KIND_WITHDRAW => {
                let recipient = match tx.recipient_str() {
                    Some(r) if tx.amount <= i64::MAX as u64 && is_canonical_qor_address(r) => {
                        r.to_string()
                    }
                    _ => continue,
                };
                let (next, _) = state.get(&counter)?;
                if next == u64::MAX {
                    continue;
                }
                state.set(&from, bal - tx.amount, nonce + 1)?;
                state.set(&counter, next + 1, 0)?;
                withdrawals.push(QledgerWithdrawal {
                    index: next,
                    recipient,
                    amount: tx.amount,
                });
            }
            _ => {}
        }
    }
    let withdrawals_root = qledger_withdrawals_root(env.chain_id, env.rollup_id, &withdrawals);
    Ok(QledgerResult {
        state_root: state.root(),
        withdrawals,
        withdrawals_root,
    })
}

fn lp(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as u32).to_be_bytes());
    out.extend_from_slice(b);
}

/// The chain's v2 withdrawal leaf (SHAKE-256, every field length-prefixed).
pub fn qledger_withdrawal_leaf(
    chain_id: &str,
    rollup_id: &str,
    index: u64,
    recipient: &str,
    amount: u64,
) -> [u8; 32] {
    let mut b = Vec::new();
    lp(&mut b, b"qorechain-rdk-withdrawal/v2");
    lp(&mut b, chain_id.as_bytes());
    lp(&mut b, rollup_id.as_bytes());
    b.extend_from_slice(&index.to_be_bytes());
    lp(&mut b, recipient.as_bytes());
    lp(&mut b, QLEDGER_WITHDRAWAL_DENOM.as_bytes());
    b.extend_from_slice(&amount.to_be_bytes());
    qorehash(&[&b])
}

/// The tree's levels, leaves first; `None` without withdrawals.
fn levels(chain_id: &str, rollup_id: &str, ws: &[QledgerWithdrawal]) -> Option<Vec<Vec<[u8; 32]>>> {
    if ws.is_empty() {
        return None;
    }
    let n = ws.len().next_power_of_two();
    // Consecutive global indices: positions index mod n are distinct.
    let mut level = vec![[0u8; 32]; n];
    for w in ws {
        level[(w.index % n as u64) as usize] =
            qledger_withdrawal_leaf(chain_id, rollup_id, w.index, &w.recipient, w.amount);
    }
    let mut out = vec![level];
    while out.last().map_or(0, Vec::len) > 1 {
        let prev = out.last().expect("a level");
        let next = prev
            .as_chunks::<2>()
            .0
            .iter()
            .map(|[l, r]| qorehash(&[l, r]))
            .collect();
        out.push(next);
    }
    Some(out)
}

/// A qledger-v1 batch's withdrawals root: its withdrawals in a tree of the
/// next power of two, each at its global index modulo that size, the rest
/// zero; empty when there is none.
pub fn qledger_withdrawals_root(
    chain_id: &str,
    rollup_id: &str,
    ws: &[QledgerWithdrawal],
) -> Vec<u8> {
    levels(chain_id, rollup_id, ws)
        .and_then(|l| l.last().map(|top| top[0].to_vec()))
        .unwrap_or_default()
}

/// The sibling path of withdrawal `i` of a batch (`ws[i]`), as
/// `MsgExecuteWithdrawal` takes it.
pub fn qledger_withdrawal_proof(
    chain_id: &str,
    rollup_id: &str,
    ws: &[QledgerWithdrawal],
    i: usize,
) -> Result<Vec<[u8; 32]>, QledgerError> {
    let l = levels(chain_id, rollup_id, ws)
        .filter(|_| i < ws.len())
        .ok_or_else(|| QledgerError::InvalidInput("no such withdrawal".to_string()))?;
    let mut idx = (ws[i].index % l[0].len() as u64) as usize;
    let mut path = Vec::with_capacity(l.len() - 1);
    for level in &l[..l.len() - 1] {
        path.push(level[idx ^ 1]);
        idx >>= 1;
    }
    Ok(path)
}
