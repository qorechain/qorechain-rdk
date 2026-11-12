//! qledger-v1 fraud proofs: the challenger's side (build) and the chain's
//! decision (check), so a watcher can decide a batch locally before paying.
//!
//! ```text
//! "QLFP" | 0x01 | acc_from[32] | be16(n) | n x (be64(height) | be16(len) poster | be32(len) payload)
//! | be16(m) | m x (id[32] | be64(balance) | be64(nonce) | bitmap[32] | popcount(bitmap) x sibling[32])
//! ```

use std::collections::HashSet;

use super::exec::{execute_qledger, QledgerEntry, QledgerEnv, QledgerResult};
use super::smt::{QledgerLedger, QledgerPartialTree, QledgerState, QledgerWitness};
use super::QledgerError;
use crate::inbox::{inbox_range_hash, InboxRangeInput, EMPTY_INBOX_ACC};

/// Most inbox entries one qledger-v1 batch may consume.
pub const QLEDGER_MAX_BATCH_ENTRIES: u64 = 64;
/// Largest post a qledger-v1 rollup accepts, in bytes.
pub const QLEDGER_MAX_POST_BYTES: usize = 6 * 1024;
const MAX_WITNESSES: usize = 2 * QLEDGER_MAX_BATCH_ENTRIES as usize;
const MAX_POSTER_LEN: usize = 256;
const MAGIC: &[u8; 4] = b"QLFP";

/// A decoded qledger-v1 fraud proof.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerFraudProof {
    /// The inbox accumulator at the batch's start.
    pub acc_from: [u8; 32],
    /// The entries the batch consumed.
    pub entries: Vec<QledgerEntry>,
    /// Every account the batch touches, opened against its parent root.
    pub witnesses: Vec<QledgerWitness>,
}

/// Encode a fraud proof.
pub fn encode_qledger_fraud_proof(p: &QledgerFraudProof) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(MAGIC);
    b.push(1);
    b.extend_from_slice(&p.acc_from);
    b.extend_from_slice(&(p.entries.len() as u16).to_be_bytes());
    for e in &p.entries {
        b.extend_from_slice(&e.height.to_be_bytes());
        b.extend_from_slice(&(e.poster.len() as u16).to_be_bytes());
        b.extend_from_slice(e.poster.as_bytes());
        b.extend_from_slice(&(e.payload.len() as u32).to_be_bytes());
        b.extend_from_slice(&e.payload);
    }
    b.extend_from_slice(&(p.witnesses.len() as u16).to_be_bytes());
    for w in &p.witnesses {
        b.extend_from_slice(&w.id);
        b.extend_from_slice(&w.balance.to_be_bytes());
        b.extend_from_slice(&w.nonce.to_be_bytes());
        b.extend_from_slice(&w.bitmap);
        for s in &w.siblings {
            b.extend_from_slice(s);
        }
    }
    b
}

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], QledgerError> {
        if self.b.len() - self.p < n {
            return Err(QledgerError::MalformedFraudProof);
        }
        let out = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(out)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], QledgerError> {
        let s = self.take(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(s);
        Ok(out)
    }

    fn u16(&mut self) -> Result<u16, QledgerError> {
        Ok(u16::from_be_bytes(self.array()?))
    }

    fn u32(&mut self) -> Result<u32, QledgerError> {
        Ok(u32::from_be_bytes(self.array()?))
    }

    fn u64(&mut self) -> Result<u64, QledgerError> {
        Ok(u64::from_be_bytes(self.array()?))
    }
}

/// Decode a fraud proof, with the chain's limits. A poster that is not UTF-8
/// is refused as malformed: no inbox entry has one.
pub fn decode_qledger_fraud_proof(b: &[u8]) -> Result<QledgerFraudProof, QledgerError> {
    let mut r = Reader { b, p: 0 };
    let head = r.take(5)?;
    if &head[..4] != MAGIC || head[4] != 1 {
        return Err(QledgerError::MalformedFraudProof);
    }
    let acc_from = r.array::<32>()?;
    let n = r.u16()? as u64;
    if n > QLEDGER_MAX_BATCH_ENTRIES {
        return Err(QledgerError::MalformedFraudProof);
    }
    let mut entries = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let height = r.u64()?;
        let pl = r.u16()? as usize;
        if pl > MAX_POSTER_LEN {
            return Err(QledgerError::MalformedFraudProof);
        }
        let poster = std::str::from_utf8(r.take(pl)?)
            .map_err(|_| QledgerError::MalformedFraudProof)?
            .to_string();
        let ln = r.u32()? as usize;
        if ln > QLEDGER_MAX_POST_BYTES {
            return Err(QledgerError::MalformedFraudProof);
        }
        let payload = r.take(ln)?.to_vec();
        entries.push(QledgerEntry {
            height,
            poster,
            payload,
        });
    }
    let m = r.u16()? as usize;
    if m > MAX_WITNESSES {
        return Err(QledgerError::MalformedFraudProof);
    }
    let mut witnesses = Vec::with_capacity(m);
    for _ in 0..m {
        let id = r.array::<32>()?;
        let balance = r.u64()?;
        let nonce = r.u64()?;
        let bitmap = r.array::<32>()?;
        let cnt: u32 = bitmap.iter().map(|x| x.count_ones()).sum();
        let mut siblings = Vec::with_capacity(cnt as usize);
        for _ in 0..cnt {
            siblings.push(r.array::<32>()?);
        }
        witnesses.push(QledgerWitness {
            id,
            balance,
            nonce,
            bitmap,
            siblings,
        });
    }
    if r.p != b.len() {
        return Err(QledgerError::MalformedFraudProof);
    }
    Ok(QledgerFraudProof {
        acc_from,
        entries,
        witnesses,
    })
}

/// Records every account an execution touches, in first-touch order.
struct Recorder {
    inner: QledgerLedger,
    seen: HashSet<[u8; 32]>,
    order: Vec<[u8; 32]>,
}

impl Recorder {
    fn note(&mut self, id: &[u8; 32]) {
        if self.seen.insert(*id) {
            self.order.push(*id);
        }
    }
}

impl QledgerState for Recorder {
    fn get(&mut self, id: &[u8; 32]) -> Result<(u64, u64), QledgerError> {
        self.note(id);
        Ok(self.inner.account(id))
    }

    fn set(&mut self, id: &[u8; 32], balance: u64, nonce: u64) -> Result<(), QledgerError> {
        self.note(id);
        self.inner.put(id, balance, nonce);
        Ok(())
    }

    fn root(&self) -> [u8; 32] {
        self.inner.root()
    }
}

/// The challenger's side: from the batch's parent state, the inbox
/// accumulator at the batch's start (empty for the first) and the entries it
/// consumed, the encoded proof to send with `challenge_batch`, and the result
/// an honest batch would have published.
pub fn build_qledger_fraud_proof(
    env: &QledgerEnv<'_>,
    parent: &QledgerLedger,
    acc_from: &[u8],
    entries: &[QledgerEntry],
) -> Result<(Vec<u8>, QledgerResult), QledgerError> {
    let acc_from: [u8; 32] = if acc_from.is_empty() {
        EMPTY_INBOX_ACC
    } else {
        acc_from.try_into().map_err(|_| {
            QledgerError::InvalidInput("the inbox accumulator is 32 bytes".to_string())
        })?
    };
    let mut rec = Recorder {
        inner: parent.clone(),
        seen: HashSet::new(),
        order: Vec::new(),
    };
    let honest = execute_qledger(env, &mut rec, entries)?;
    let proof = encode_qledger_fraud_proof(&QledgerFraudProof {
        acc_from,
        entries: entries.to_vec(),
        witnesses: rec.order.iter().map(|id| parent.witness(id)).collect(),
    });
    Ok((proof, honest))
}

/// What a qledger-v1 batch published.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QledgerClaim {
    /// The consumed position before the batch.
    pub inbox_start: u64,
    /// The batch's `inbox_end`.
    pub inbox_end: u64,
    /// The batch's `data_hash` (the inbox range commitment).
    pub data_hash: Vec<u8>,
    /// The batch's parent state root.
    pub prev_state_root: Vec<u8>,
    /// The state root it published.
    pub state_root: Vec<u8>,
    /// The withdrawals root it published.
    pub withdrawals_root: Vec<u8>,
}

/// Decide a fraud proof as the chain does: `true` when re-executing the
/// batch's inputs from its parent state gives a different state or withdrawals
/// root than it published, `false` when the batch is right. Fails when the
/// proof cannot decide (malformed, not about this batch, incomplete witness):
/// the chain refuses such a challenge.
pub fn check_qledger_fraud(
    env: &QledgerEnv<'_>,
    claim: &QledgerClaim,
    proof: &[u8],
) -> Result<bool, QledgerError> {
    let p = decode_qledger_fraud_proof(proof)?;
    let (start, end) = (claim.inbox_start, claim.inbox_end);
    if end < start || p.entries.len() as u64 != end - start {
        return Err(QledgerError::NotApplicable(format!(
            "{} entries for inbox range {start}..{end}",
            p.entries.len()
        )));
    }
    let acc = super::batch::qledger_accumulate(
        env.chain_id,
        env.rollup_id,
        start,
        &p.acc_from,
        &p.entries,
    );
    let want = inbox_range_hash(&InboxRangeInput {
        chain_id: env.chain_id,
        rollup_id: env.rollup_id,
        from: start,
        to: end,
        acc_from: &p.acc_from,
        acc_to: &acc,
    });
    if want.as_slice() != claim.data_hash.as_slice() {
        return Err(QledgerError::NotApplicable(
            "the entries do not hash to the batch's inbox range".to_string(),
        ));
    }
    let prev: [u8; 32] = claim.prev_state_root.as_slice().try_into().map_err(|_| {
        QledgerError::NotApplicable("the batch has no 32-byte parent root".to_string())
    })?;
    let mut tree = QledgerPartialTree::new(&prev, &p.witnesses)?;
    let res = execute_qledger(env, &mut tree, &p.entries)?;
    Ok(res.state_root.as_slice() != claim.state_root.as_slice()
        || res.withdrawals_root != claim.withdrawals_root)
}
