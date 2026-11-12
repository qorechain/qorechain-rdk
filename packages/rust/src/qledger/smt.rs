//! The qledger-v1 state tree: a sparse Merkle tree of depth 256 over account
//! ids (SHA-256), one level per bit, most significant bit first.
//!
//! ```text
//! empty leaf = SHA-256(0x00 | "qledger/v1/empty")
//! leaf       = SHA-256(0x00 | id[32] | be64(balance) | be64(nonce))   (empty leaf when both are 0)
//! node       = SHA-256(0x01 | left | right)
//! ```

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use sha2::{Digest, Sha256};

use super::QledgerError;

/// Depth of the state tree.
pub const QLEDGER_DEPTH: usize = 256;

fn empty_hashes() -> &'static [[u8; 32]; QLEDGER_DEPTH + 1] {
    static EMPTY: OnceLock<[[u8; 32]; QLEDGER_DEPTH + 1]> = OnceLock::new();
    EMPTY.get_or_init(|| {
        let mut e = [[0u8; 32]; QLEDGER_DEPTH + 1];
        let mut h = Sha256::new();
        h.update([0x00]);
        h.update(b"qledger/v1/empty");
        e[0] = h.finalize().into();
        for i in 1..=QLEDGER_DEPTH {
            e[i] = hash_node(&e[i - 1], &e[i - 1]);
        }
        e
    })
}

fn empty(h: usize) -> &'static [u8; 32] {
    &empty_hashes()[h]
}

fn hash_node(l: &[u8; 32], r: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([0x01]);
    h.update(l);
    h.update(r);
    h.finalize().into()
}

/// The root of an empty subtree of height `h` (0 = the empty leaf). Panics for
/// `h` above [`QLEDGER_DEPTH`].
pub fn qledger_empty_hash(h: usize) -> [u8; 32] {
    *empty(h)
}

/// The state root of a ledger with no account: the parent root of a rollup's
/// first batch.
pub fn qledger_empty_root() -> [u8; 32] {
    *empty(QLEDGER_DEPTH)
}

/// The leaf of an account (the empty leaf for a zero account).
pub fn qledger_leaf_hash(id: &[u8; 32], balance: u64, nonce: u64) -> [u8; 32] {
    if balance == 0 && nonce == 0 {
        return *empty(0);
    }
    let mut h = Sha256::new();
    h.update([0x00]);
    h.update(id);
    h.update(balance.to_be_bytes());
    h.update(nonce.to_be_bytes());
    h.finalize().into()
}

fn bit(id: &[u8; 32], i: usize) -> u8 {
    (id[i >> 3] >> (7 - (i & 7))) & 1
}

/// Opens one account against a state root. Siblings run leaf to root, only the
/// non-empty ones, flagged in `bitmap` (bit `d-1` for depth `d`, most
/// significant bit first).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerWitness {
    /// The account id.
    pub id: [u8; 32],
    /// Its balance.
    pub balance: u64,
    /// Its nonce.
    pub nonce: u64,
    /// Which depths carry a sibling.
    pub bitmap: [u8; 32],
    /// The non-empty siblings, leaf to root.
    pub siblings: Vec<[u8; 32]>,
}

/// What execution reads and writes.
pub trait QledgerState {
    /// An account's `(balance, nonce)`; `(0, 0)` for an account that does not
    /// exist.
    fn get(&mut self, id: &[u8; 32]) -> Result<(u64, u64), QledgerError>;
    /// Write an account.
    fn set(&mut self, id: &[u8; 32], balance: u64, nonce: u64) -> Result<(), QledgerError>;
    /// The current state root.
    fn root(&self) -> [u8; 32];
}

/// A whole qledger-v1 state in memory: what a submitter or a challenger keeps,
/// and what builds witnesses. Zero accounts are not stored, so the root is
/// unique for a state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QledgerLedger {
    accts: BTreeMap<[u8; 32], (u64, u64)>,
}

impl QledgerLedger {
    /// An empty ledger (root [`qledger_empty_root`]).
    pub fn new() -> Self {
        Self::default()
    }

    /// An account's `(balance, nonce)`.
    pub fn account(&self, id: &[u8; 32]) -> (u64, u64) {
        self.accts.get(id).copied().unwrap_or((0, 0))
    }

    /// Write an account; a zero account is removed.
    pub fn put(&mut self, id: &[u8; 32], balance: u64, nonce: u64) {
        if balance == 0 && nonce == 0 {
            self.accts.remove(id);
        } else {
            self.accts.insert(*id, (balance, nonce));
        }
    }

    /// Every non-zero account as `(id, balance, nonce)`, sorted by id.
    pub fn accounts(&self) -> Vec<([u8; 32], u64, u64)> {
        self.accts.iter().map(|(id, &(b, n))| (*id, b, n)).collect()
    }

    /// The root of the subtree at depth `d` holding `ids` (sorted, all under
    /// the same prefix of length `d`).
    fn subtree(&self, d: usize, ids: &[[u8; 32]]) -> [u8; 32] {
        match ids {
            [] => *empty(QLEDGER_DEPTH - d),
            [id] => {
                let (b, n) = self.account(id);
                let mut cur = qledger_leaf_hash(id, b, n);
                for dd in (d + 1..=QLEDGER_DEPTH).rev() {
                    let e = empty(QLEDGER_DEPTH - dd);
                    cur = if bit(id, dd - 1) == 0 {
                        hash_node(&cur, e)
                    } else {
                        hash_node(e, &cur)
                    };
                }
                cur
            }
            _ => {
                let split = ids.partition_point(|x| bit(x, d) == 0);
                hash_node(
                    &self.subtree(d + 1, &ids[..split]),
                    &self.subtree(d + 1, &ids[split..]),
                )
            }
        }
    }

    fn sorted_ids(&self) -> Vec<[u8; 32]> {
        self.accts.keys().copied().collect()
    }

    /// The state root.
    pub fn root(&self) -> [u8; 32] {
        self.subtree(0, &self.sorted_ids())
    }

    /// A witness for `id` (present or not) against [`QledgerLedger::root`].
    pub fn witness(&self, id: &[u8; 32]) -> QledgerWitness {
        let (balance, nonce) = self.account(id);
        let mut w = QledgerWitness {
            id: *id,
            balance,
            nonce,
            bitmap: [0u8; 32],
            siblings: Vec::new(),
        };
        let ids = self.sorted_ids();
        for d in (1..=QLEDGER_DEPTH).rev() {
            let want = sib_key(id, d);
            let under: Vec<[u8; 32]> = ids
                .iter()
                .filter(|x| key_of(x, d) == want)
                .copied()
                .collect();
            let sib = self.subtree(d, &under);
            if &sib != empty(QLEDGER_DEPTH - d) {
                w.bitmap[(d - 1) >> 3] |= 1 << (7 - ((d - 1) & 7));
                w.siblings.push(sib);
            }
        }
        w
    }
}

impl QledgerState for QledgerLedger {
    fn get(&mut self, id: &[u8; 32]) -> Result<(u64, u64), QledgerError> {
        Ok(self.account(id))
    }

    fn set(&mut self, id: &[u8; 32], balance: u64, nonce: u64) -> Result<(), QledgerError> {
        self.put(id, balance, nonce);
        Ok(())
    }

    fn root(&self) -> [u8; 32] {
        QledgerLedger::root(self)
    }
}

/// A node position: its depth and the id prefix of that length.
type NodeKey = (u16, [u8; 32]);

fn key_of(id: &[u8; 32], d: usize) -> NodeKey {
    let mut p = [0u8; 32];
    p[..d >> 3].copy_from_slice(&id[..d >> 3]);
    if d & 7 != 0 {
        p[d >> 3] = id[d >> 3] & (0xffu8 << (8 - (d & 7)));
    }
    (d as u16, p)
}

fn sib_key(id: &[u8; 32], d: usize) -> NodeKey {
    let mut f = *id;
    f[(d - 1) >> 3] ^= 1 << (7 - ((d - 1) & 7));
    key_of(&f, d)
}

/// The part of a state tree a set of witnesses opens, checked against a root
/// (what the chain builds from a fraud proof). Reading an account outside it
/// fails with [`QledgerError::IncompleteWitness`].
#[derive(Debug, Clone)]
pub struct QledgerPartialTree {
    nodes: HashMap<NodeKey, [u8; 32]>,
    accts: HashMap<[u8; 32], (u64, u64)>,
    current: [u8; 32],
}

impl QledgerPartialTree {
    /// Open `witnesses` against `root`; [`QledgerError::BadWitness`] when one
    /// does not match it or two disagree.
    pub fn new(root: &[u8; 32], witnesses: &[QledgerWitness]) -> Result<Self, QledgerError> {
        let mut t = QledgerPartialTree {
            nodes: HashMap::new(),
            accts: HashMap::new(),
            current: *root,
        };
        for w in witnesses {
            let mut cur = qledger_leaf_hash(&w.id, w.balance, w.nonce);
            t.put(key_of(&w.id, QLEDGER_DEPTH), cur)?;
            let mut si = 0;
            for d in (1..=QLEDGER_DEPTH).rev() {
                let mut sib = *empty(QLEDGER_DEPTH - d);
                if (w.bitmap[(d - 1) >> 3] >> (7 - ((d - 1) & 7))) & 1 == 1 {
                    sib = *w.siblings.get(si).ok_or(QledgerError::BadWitness)?;
                    si += 1;
                }
                t.put(sib_key(&w.id, d), sib)?;
                cur = if bit(&w.id, d - 1) == 0 {
                    hash_node(&cur, &sib)
                } else {
                    hash_node(&sib, &cur)
                };
                t.put(key_of(&w.id, d - 1), cur)?;
            }
            if si != w.siblings.len() || &cur != root {
                return Err(QledgerError::BadWitness);
            }
            t.accts.insert(w.id, (w.balance, w.nonce));
        }
        Ok(t)
    }

    fn put(&mut self, k: NodeKey, v: [u8; 32]) -> Result<(), QledgerError> {
        if let Some(old) = self.nodes.get(&k) {
            if old != &v {
                return Err(QledgerError::BadWitness);
            }
        }
        self.nodes.insert(k, v);
        Ok(())
    }
}

impl QledgerState for QledgerPartialTree {
    fn get(&mut self, id: &[u8; 32]) -> Result<(u64, u64), QledgerError> {
        self.accts
            .get(id)
            .copied()
            .ok_or(QledgerError::IncompleteWitness)
    }

    fn set(&mut self, id: &[u8; 32], balance: u64, nonce: u64) -> Result<(), QledgerError> {
        if !self.accts.contains_key(id) {
            return Err(QledgerError::IncompleteWitness);
        }
        self.accts.insert(*id, (balance, nonce));
        let mut cur = qledger_leaf_hash(id, balance, nonce);
        self.nodes.insert(key_of(id, QLEDGER_DEPTH), cur);
        for d in (1..=QLEDGER_DEPTH).rev() {
            let sib = *self
                .nodes
                .get(&sib_key(id, d))
                .ok_or(QledgerError::IncompleteWitness)?;
            cur = if bit(id, d - 1) == 0 {
                hash_node(&cur, &sib)
            } else {
                hash_node(&sib, &cur)
            };
            self.nodes.insert(key_of(id, d - 1), cur);
        }
        self.current = cur;
        Ok(())
    }

    fn root(&self) -> [u8; 32] {
        self.current
    }
}
