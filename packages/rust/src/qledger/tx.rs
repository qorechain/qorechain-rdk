//! qledger-v1 transactions and deposits (chain v3.2.8+, `rdk-optimistic-reexec`).
//!
//! A qledger-v1 rollup is a uqor account ledger. Its inputs are the rollup's
//! inbox entries: user posts carrying one signed transaction each, and deposit
//! entries the chain appends for `MsgDepositToRollup`.
//!
//! ```text
//! tx       = 0x01 | scheme | public_key | kind | be64(nonce) | body | be64(amount) | signature
//! transfer = to[32]
//! withdraw = u8(len) | recipient (bech32)
//! ```
//!
//! The only scheme is ML-DSA-44 (`scheme` 1), signed deterministically with the
//! FIPS 204 context `"qledger/v1"` ([`QLEDGER_SIGNING_CONTEXT`]) over
//! `SHA-256("qledger/v1/tx" | lp(chain_id) | lp(rollup_id) | unsigned)`.
//!
//! [`QledgerTx::sign`] signs and [`MLDSA44_VERIFIER`] verifies with that
//! context. Execution takes any [`QledgerVerifier`], so a caller can plug in
//! another implementation; [`QledgerTx::sign_with`] does the same for signing.

use sha2::{Digest, Sha256};

use super::QledgerError;

/// ML-DSA-44, the only qledger-v1 account scheme.
pub const QLEDGER_SCHEME_MLDSA44: u8 = 1;
/// A transfer to another account.
pub const QLEDGER_KIND_TRANSFER: u8 = 1;
/// A withdrawal to a `qor1` address on the chain.
pub const QLEDGER_KIND_WITHDRAW: u8 = 2;
/// Longest withdrawal recipient (a bech32 address), in bytes.
pub const QLEDGER_MAX_RECIPIENT_LEN: usize = 90;
/// Poster prefix of the inbox entries the chain writes for deposits.
pub const QLEDGER_DEPOSIT_POSTER_PREFIX: &str = "deposit:";
/// The FIPS 204 context of every qledger-v1 signature.
pub const QLEDGER_SIGNING_CONTEXT: &[u8] = b"qledger/v1";
/// ML-DSA-44 public key size, in bytes.
pub const QLEDGER_MLDSA44_PUBLIC_KEY_SIZE: usize = 1312;
/// ML-DSA-44 signature size, in bytes.
pub const QLEDGER_MLDSA44_SIGNATURE_SIZE: usize = 2420;

const TX_VERSION: u8 = 1;
const DEPOSIT_MAGIC: &[u8; 4] = b"QLDP";
const DEPOSIT_LEN: usize = 4 + 32 + 8;

/// Checks a qledger-v1 signature: ML-DSA-44 over `message` under `public_key`,
/// with the FIPS 204 context [`QLEDGER_SIGNING_CONTEXT`].
///
/// Execution and fraud-proof checks call it for every transaction they read.
/// A closure `Fn(&[u8], &[u8], &[u8]) -> bool` taking `(public_key, message,
/// signature)` implements it.
pub trait QledgerVerifier {
    /// Whether `signature` is valid for `message` under `public_key`.
    fn verify(&self, public_key: &[u8], message: &[u8], signature: &[u8]) -> bool;
}

impl<F> QledgerVerifier for F
where
    F: Fn(&[u8], &[u8], &[u8]) -> bool,
{
    fn verify(&self, public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
        self(public_key, message, signature)
    }
}

/// The built-in ML-DSA-44 verifier (FIPS 204 context [`QLEDGER_SIGNING_CONTEXT`]).
#[derive(Debug, Clone, Copy, Default)]
pub struct Mldsa44Verifier;

/// The built-in verifier, to pass wherever a [`QledgerVerifier`] is taken.
pub const MLDSA44_VERIFIER: Mldsa44Verifier = Mldsa44Verifier;

impl QledgerVerifier for Mldsa44Verifier {
    fn verify(&self, public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
        use fips204::traits::{SerDes, Verifier};
        let (Ok(pk), Ok(sig)) = (
            <[u8; QLEDGER_MLDSA44_PUBLIC_KEY_SIZE]>::try_from(public_key),
            <[u8; QLEDGER_MLDSA44_SIGNATURE_SIZE]>::try_from(signature),
        ) else {
            return false;
        };
        match fips204::ml_dsa_44::PublicKey::try_from_bytes(pk) {
            Ok(pk) => pk.verify(message, &sig, QLEDGER_SIGNING_CONTEXT),
            Err(_) => false,
        }
    }
}

/// A qledger-v1 transaction. `to` is used by a transfer, `recipient` by a
/// withdrawal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QledgerTx {
    /// The signature scheme ([`QLEDGER_SCHEME_MLDSA44`]).
    pub scheme: u8,
    /// The sender's public key.
    pub public_key: Vec<u8>,
    /// [`QLEDGER_KIND_TRANSFER`] or [`QLEDGER_KIND_WITHDRAW`].
    pub kind: u8,
    /// The sender's nonce.
    pub nonce: u64,
    /// A transfer's receiving account id.
    pub to: [u8; 32],
    /// A withdrawal's recipient, as posted (bytes, so that a payload is kept
    /// exactly as the chain reads it). A withdrawal pays only a canonical
    /// `qor1` address.
    pub recipient: Vec<u8>,
    /// The amount, in uqor.
    pub amount: u64,
    /// The signature (empty before signing).
    pub signature: Vec<u8>,
}

/// An ML-DSA-44 account key pair and the account id it controls.
#[derive(Clone, PartialEq, Eq)]
pub struct QledgerKeypair {
    /// The public key (1,312 bytes).
    pub public_key: Vec<u8>,
    /// The secret key (2,560 bytes).
    pub secret_key: Vec<u8>,
    /// [`qledger_account_id`] of the public key.
    pub account_id: [u8; 32],
}

impl std::fmt::Debug for QledgerKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QledgerKeypair")
            .field("public_key", &hex::encode(&self.public_key))
            .field("account_id", &hex::encode(self.account_id))
            .finish_non_exhaustive()
    }
}

/// The account id a public key controls:
/// `SHA-256("qledger/v1/account" | scheme | public_key)`.
pub fn qledger_account_id(public_key: &[u8], scheme: u8) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"qledger/v1/account");
    h.update([scheme]);
    h.update(public_key);
    h.finalize().into()
}

/// An ML-DSA-44 account key pair from a 32-byte FIPS 204 seed, and its
/// account id.
pub fn qledger_keypair_from_seed(seed: &[u8]) -> Result<QledgerKeypair, QledgerError> {
    let seed: &[u8; 32] = seed.try_into().map_err(|_| {
        QledgerError::InvalidInput(format!("an ML-DSA-44 seed is 32 bytes, got {}", seed.len()))
    })?;
    let (public_key, secret_key) = qorechain_pqc::mldsa::ml_dsa_44::keygen_from_seed(seed);
    let account_id = qledger_account_id(&public_key, QLEDGER_SCHEME_MLDSA44);
    Ok(QledgerKeypair {
        public_key,
        secret_key,
        account_id,
    })
}

/// What an account signs: the transaction bound to one chain and one rollup.
pub fn qledger_signing_message(chain_id: &str, rollup_id: &str, unsigned: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"qledger/v1/tx");
    h.update((chain_id.len() as u32).to_be_bytes());
    h.update(chain_id.as_bytes());
    h.update((rollup_id.len() as u32).to_be_bytes());
    h.update(rollup_id.as_bytes());
    h.update(unsigned);
    h.finalize().into()
}

impl QledgerTx {
    /// An unsigned transfer of `amount` uqor to account `to`.
    pub fn transfer(public_key: Vec<u8>, nonce: u64, to: [u8; 32], amount: u64) -> Self {
        QledgerTx {
            scheme: QLEDGER_SCHEME_MLDSA44,
            public_key,
            kind: QLEDGER_KIND_TRANSFER,
            nonce,
            to,
            recipient: Vec::new(),
            amount,
            signature: Vec::new(),
        }
    }

    /// An unsigned withdrawal of `amount` uqor to the canonical `qor1`
    /// address `recipient` (1 to [`QLEDGER_MAX_RECIPIENT_LEN`] bytes; the
    /// chain reads a longer one as a no-op).
    pub fn withdraw(
        public_key: Vec<u8>,
        nonce: u64,
        recipient: &str,
        amount: u64,
    ) -> Result<Self, QledgerError> {
        if recipient.is_empty() || recipient.len() > QLEDGER_MAX_RECIPIENT_LEN {
            return Err(QledgerError::InvalidInput(format!(
                "a withdrawal recipient is 1 to {QLEDGER_MAX_RECIPIENT_LEN} bytes, got {} (the \
                 chain would read the transaction as a no-op)",
                recipient.len()
            )));
        }
        Ok(QledgerTx {
            scheme: QLEDGER_SCHEME_MLDSA44,
            public_key,
            kind: QLEDGER_KIND_WITHDRAW,
            nonce,
            to: [0u8; 32],
            recipient: recipient.as_bytes().to_vec(),
            amount,
            signature: Vec::new(),
        })
    }

    /// The recipient as text, when it is valid UTF-8.
    pub fn recipient_str(&self) -> Option<&str> {
        std::str::from_utf8(&self.recipient).ok()
    }

    /// The account the transaction spends from.
    pub fn from_account(&self) -> [u8; 32] {
        qledger_account_id(&self.public_key, self.scheme)
    }

    /// The encoding without the signature.
    pub fn unsigned(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(2 + self.public_key.len() + 1 + 8 + 32 + 8);
        b.push(TX_VERSION);
        b.push(self.scheme);
        b.extend_from_slice(&self.public_key);
        b.push(self.kind);
        b.extend_from_slice(&self.nonce.to_be_bytes());
        match self.kind {
            QLEDGER_KIND_TRANSFER => b.extend_from_slice(&self.to),
            QLEDGER_KIND_WITHDRAW => {
                b.push(self.recipient.len() as u8);
                b.extend_from_slice(&self.recipient);
            }
            _ => {}
        }
        b.extend_from_slice(&self.amount.to_be_bytes());
        b
    }

    /// The transaction as posted.
    pub fn encode(&self) -> Vec<u8> {
        let mut b = self.unsigned();
        b.extend_from_slice(&self.signature);
        b
    }

    /// [`qledger_signing_message`] of this transaction.
    pub fn signing_message(&self, chain_id: &str, rollup_id: &str) -> [u8; 32] {
        qledger_signing_message(chain_id, rollup_id, &self.unsigned())
    }

    /// Sign deterministically with an ML-DSA-44 secret key (as
    /// [`qledger_keypair_from_seed`] returns it) and the FIPS 204 context
    /// [`QLEDGER_SIGNING_CONTEXT`]. Reproduces the chain's own signatures. Post
    /// the result with `post_rollup_data`, one transaction per post.
    pub fn sign(
        self,
        chain_id: &str,
        rollup_id: &str,
        secret_key: &[u8],
    ) -> Result<Self, QledgerError> {
        use fips204::traits::{SerDes, Signer};
        self.sign_with(chain_id, rollup_id, |msg| {
            let sk: [u8; fips204::ml_dsa_44::SK_LEN] = secret_key.try_into().map_err(|_| {
                QledgerError::InvalidInput(format!(
                    "an ML-DSA-44 secret key is {} bytes, got {}",
                    fips204::ml_dsa_44::SK_LEN,
                    secret_key.len()
                ))
            })?;
            let sk = fips204::ml_dsa_44::PrivateKey::try_from_bytes(sk)
                .map_err(|e| QledgerError::InvalidInput(e.to_string()))?;
            // Deterministic FIPS 204 signing: the 32-byte randomness is zero.
            let sig = sk
                .try_sign_with_seed(&[0u8; 32], msg, QLEDGER_SIGNING_CONTEXT)
                .map_err(|e| QledgerError::InvalidInput(e.to_string()))?;
            Ok(sig.to_vec())
        })
    }

    /// Sign with `sign`, which receives the signing message and returns the
    /// ML-DSA-44 signature made with the FIPS 204 context
    /// [`QLEDGER_SIGNING_CONTEXT`], for a key held elsewhere (a signer service
    /// or hardware). [`QledgerTx::sign`] does this with a local key.
    pub fn sign_with<E>(
        mut self,
        chain_id: &str,
        rollup_id: &str,
        sign: impl FnOnce(&[u8; 32]) -> Result<Vec<u8>, E>,
    ) -> Result<Self, E> {
        let msg = self.signing_message(chain_id, rollup_id);
        self.signature = sign(&msg)?;
        Ok(self)
    }
}

/// The encoding without the signature ([`QledgerTx::unsigned`]).
pub fn qledger_tx_unsigned(tx: &QledgerTx) -> Vec<u8> {
    tx.unsigned()
}

/// The transaction as posted ([`QledgerTx::encode`]).
pub fn encode_qledger_tx(tx: &QledgerTx) -> Vec<u8> {
    tx.encode()
}

/// Parse a posted payload; `None` for anything that is not exactly one
/// well-formed transaction.
pub fn decode_qledger_tx(b: &[u8]) -> Option<QledgerTx> {
    if b.len() < 2 || b[0] != TX_VERSION || b[1] != QLEDGER_SCHEME_MLDSA44 {
        return None;
    }
    let mut p = 2;
    if b.len() < p + QLEDGER_MLDSA44_PUBLIC_KEY_SIZE + 1 + 8 {
        return None;
    }
    let public_key = b[p..p + QLEDGER_MLDSA44_PUBLIC_KEY_SIZE].to_vec();
    p += QLEDGER_MLDSA44_PUBLIC_KEY_SIZE;
    let kind = b[p];
    p += 1;
    let nonce = u64::from_be_bytes(b[p..p + 8].try_into().ok()?);
    p += 8;
    let mut to = [0u8; 32];
    let mut recipient = Vec::new();
    match kind {
        QLEDGER_KIND_TRANSFER => {
            if b.len() < p + 32 {
                return None;
            }
            to.copy_from_slice(&b[p..p + 32]);
            p += 32;
        }
        QLEDGER_KIND_WITHDRAW => {
            if b.len() < p + 1 {
                return None;
            }
            let n = b[p] as usize;
            p += 1;
            if n == 0 || n > QLEDGER_MAX_RECIPIENT_LEN || b.len() < p + n {
                return None;
            }
            recipient = b[p..p + n].to_vec();
            p += n;
        }
        _ => return None,
    }
    if b.len() != p + 8 + QLEDGER_MLDSA44_SIGNATURE_SIZE {
        return None;
    }
    let amount = u64::from_be_bytes(b[p..p + 8].try_into().ok()?);
    p += 8;
    Some(QledgerTx {
        scheme: QLEDGER_SCHEME_MLDSA44,
        public_key,
        kind,
        nonce,
        to,
        recipient,
        amount,
        signature: b[p..].to_vec(),
    })
}

/// Whether `tx` carries a valid signature for `chain_id` / `rollup_id`.
pub fn verify_qledger_tx(
    tx: &QledgerTx,
    chain_id: &str,
    rollup_id: &str,
    verifier: &dyn QledgerVerifier,
) -> bool {
    if tx.scheme != QLEDGER_SCHEME_MLDSA44
        || tx.public_key.len() != QLEDGER_MLDSA44_PUBLIC_KEY_SIZE
        || tx.signature.len() != QLEDGER_MLDSA44_SIGNATURE_SIZE
    {
        return false;
    }
    let msg = tx.signing_message(chain_id, rollup_id);
    verifier.verify(&tx.public_key, &msg, &tx.signature)
}

/// The payload of a deposit entry: `"QLDP" | account[32] | be64(amount)`.
pub fn encode_qledger_deposit(account: &[u8; 32], amount: u64) -> Vec<u8> {
    let mut b = Vec::with_capacity(DEPOSIT_LEN);
    b.extend_from_slice(DEPOSIT_MAGIC);
    b.extend_from_slice(account);
    b.extend_from_slice(&amount.to_be_bytes());
    b
}

/// Parse a deposit payload into `(account, amount)`.
pub fn decode_qledger_deposit(b: &[u8]) -> Option<([u8; 32], u64)> {
    if b.len() != DEPOSIT_LEN || &b[..4] != DEPOSIT_MAGIC {
        return None;
    }
    let account: [u8; 32] = b[4..36].try_into().ok()?;
    Some((account, u64::from_be_bytes(b[36..].try_into().ok()?)))
}
