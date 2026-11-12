//! Private-rollup envelopes (chain v3.2.8+, `rdk-private-rollups`).
//!
//! Every post on a private (`privacy: "encapsulated"`) rollup is an envelope:
//! the data encrypted once with AES-256-GCM under a fresh content key, and that
//! key encapsulated with ML-KEM-1024 to every member's key from the chain's KEM
//! registry, with a key commitment so all members open the same content. The
//! chain checks the envelope's structure and that every entry names a current
//! member's current key; it never decrypts.
//!
//! Posts, poster, timing, sizes, members, roots and withdrawals stay public.
//!
//! Layout (all integers big-endian):
//!
//! ```text
//! "QPRV" | 0x01 | be64(epoch) | key_commit(32) | be16(n)
//! n x ( be16(len) | member | fingerprint(32) | kem_ciphertext(1568) | wrapped_key(48) )
//! ciphertext (AES-256-GCM, zero nonce, AAD = everything before it)
//! ```
//!
//! This crate parses envelopes and mirrors the chain's membership check, and
//! reads a private rollup's recipients
//! (`RestClient::get_private_rollup_recipients`). Sealing and opening are not
//! provided here: they need AES-256-GCM, which this crate does not carry. Use
//! the TypeScript or Go kit to seal and open.

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::client::rest::RestError;

const MAGIC: &[u8; 4] = b"QPRV";
const VERSION: u8 = 1;
/// ML-KEM-1024 ciphertext size.
pub const KEM_CIPHERTEXT_SIZE: usize = 1568;
/// ML-KEM-1024 encapsulation (public) key size.
pub const ENCAPSULATION_KEY_SIZE: usize = 1568;
/// The content key under AES-256-GCM (32 + 16 tag).
pub const WRAPPED_KEY_SIZE: usize = 48;
/// The shortest payload: the GCM tag.
pub const MIN_PAYLOAD_SIZE: usize = 16;
/// Most members (envelope entries) a private rollup can have.
pub const MAX_ENVELOPE_MEMBERS: usize = 32;
/// Longest member address in an entry, in bytes.
pub const MAX_ADDRESS_LEN: usize = 128;

/// A malformed envelope.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("privpost: malformed envelope: {0}")]
pub struct EnvelopeError(pub String);

/// One member's entry in an envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeEntry {
    /// The member address.
    pub member: String,
    /// SHA-256 of the member's ML-KEM-1024 encapsulation key.
    pub fingerprint: [u8; 32],
    /// The ML-KEM-1024 ciphertext.
    pub kem_ciphertext: Vec<u8>,
    /// The wrapped content key.
    pub wrapped_key: Vec<u8>,
}

/// A parsed envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    /// The membership epoch the envelope was sealed for.
    pub epoch: u64,
    /// The content-key commitment.
    pub key_commit: [u8; 32],
    /// One entry per member, in the rollup's member order.
    pub entries: Vec<EnvelopeEntry>,
    /// The AES-256-GCM payload.
    pub ciphertext: Vec<u8>,
    /// Everything before `ciphertext`: the payload's additional data.
    pub header: Vec<u8>,
}

/// A recipient: a member address and its ML-KEM-1024 encapsulation key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeRecipient {
    /// The member address.
    pub member: String,
    /// The 1568-byte encapsulation key.
    pub encapsulation_key: Vec<u8>,
}

/// The fingerprint the chain matches against a member's registered key.
pub fn kem_key_fingerprint(encapsulation_key: &[u8]) -> [u8; 32] {
    Sha256::digest(encapsulation_key).into()
}

/// Parse an envelope and check every size (not membership: the chain does
/// that, see [`envelope_membership_error`]).
pub fn parse_envelope(b: &[u8]) -> Result<Envelope, EnvelopeError> {
    let malformed = |why: &str| EnvelopeError(why.to_string());
    if b.len() < 5 + 8 + 32 + 2 || &b[..4] != MAGIC || b[4] != VERSION {
        return Err(malformed("bad header"));
    }
    let mut p = 5;
    let epoch = u64::from_be_bytes(b[p..p + 8].try_into().expect("8 bytes"));
    p += 8;
    let key_commit: [u8; 32] = b[p..p + 32].try_into().expect("32 bytes");
    p += 32;
    let n = u16::from_be_bytes([b[p], b[p + 1]]) as usize;
    p += 2;
    if n == 0 || n > MAX_ENVELOPE_MEMBERS {
        return Err(EnvelopeError(format!("{n} entries")));
    }
    let mut entries = Vec::with_capacity(n);
    for _ in 0..n {
        if b.len() - p < 2 {
            return Err(malformed("truncated entry"));
        }
        let al = u16::from_be_bytes([b[p], b[p + 1]]) as usize;
        p += 2;
        if al == 0
            || al > MAX_ADDRESS_LEN
            || b.len() - p < al + 32 + KEM_CIPHERTEXT_SIZE + WRAPPED_KEY_SIZE
        {
            return Err(malformed("truncated entry"));
        }
        let member = String::from_utf8_lossy(&b[p..p + al]).into_owned();
        p += al;
        let fingerprint: [u8; 32] = b[p..p + 32].try_into().expect("32 bytes");
        p += 32;
        let kem_ciphertext = b[p..p + KEM_CIPHERTEXT_SIZE].to_vec();
        p += KEM_CIPHERTEXT_SIZE;
        let wrapped_key = b[p..p + WRAPPED_KEY_SIZE].to_vec();
        p += WRAPPED_KEY_SIZE;
        entries.push(EnvelopeEntry {
            member,
            fingerprint,
            kem_ciphertext,
            wrapped_key,
        });
    }
    if b.len() - p < MIN_PAYLOAD_SIZE {
        return Err(malformed("payload shorter than its tag"));
    }
    Ok(Envelope {
        epoch,
        key_commit,
        entries,
        ciphertext: b[p..].to_vec(),
        header: b[..p].to_vec(),
    })
}

/// Why the chain would refuse `envelope` as a post on a private rollup, or
/// `None` if it would accept its structure. Mirrors the chain's check: the
/// envelope's epoch is the rollup's membership epoch, there is one entry per
/// member in the rollup's order, and each entry names that member's registered
/// ML-KEM-1024 key. It does not decrypt.
pub fn envelope_membership_error(
    envelope: &[u8],
    members_epoch: u64,
    members: &[EnvelopeRecipient],
) -> Option<String> {
    let fingerprints: Vec<(&str, [u8; 32])> = members
        .iter()
        .map(|m| (m.member.as_str(), kem_key_fingerprint(&m.encapsulation_key)))
        .collect();
    envelope_membership_error_by_fingerprint(envelope, members_epoch, &fingerprints)
}

/// [`envelope_membership_error`] with each member's key given by its
/// fingerprint (SHA-256 of the encapsulation key) instead of the key itself.
pub fn envelope_membership_error_by_fingerprint(
    envelope: &[u8],
    members_epoch: u64,
    members: &[(&str, [u8; 32])],
) -> Option<String> {
    if members.is_empty() {
        return Some("the rollup has no members yet".to_string());
    }
    let e = match parse_envelope(envelope) {
        Ok(e) => e,
        Err(err) => return Some(err.to_string()),
    };
    if e.epoch != members_epoch {
        return Some(format!(
            "envelope epoch {}, the rollup's membership epoch is {members_epoch}",
            e.epoch
        ));
    }
    if e.entries.len() != members.len() {
        return Some(format!(
            "{} entries for {} members",
            e.entries.len(),
            members.len()
        ));
    }
    for (i, ((member, fingerprint), got)) in members.iter().zip(&e.entries).enumerate() {
        if got.member != *member {
            return Some(format!(
                "entry {i} is for {}, member {i} is {member}",
                got.member
            ));
        }
        if got.fingerprint != *fingerprint {
            return Some(format!(
                "entry {i} does not name {member}'s registered KEM key"
            ));
        }
    }
    None
}

/// The recipients a post on a private rollup must be sealed to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivateRollupRecipients {
    /// The membership epoch an envelope must carry.
    pub epoch: i64,
    /// The members in order, each with its registered ML-KEM-1024 key.
    pub recipients: Vec<EnvelopeRecipient>,
}

/// Why a private rollup's recipients could not be read.
#[derive(Debug, Clone, Error)]
pub enum RecipientsError {
    /// A read failed.
    #[error(transparent)]
    Rest(#[from] RestError),
    /// The rollup is not private.
    #[error("rollup {0} is not private")]
    NotPrivate(String),
    /// The rollup has no members yet.
    #[error("rollup {0} has no members yet")]
    NoMembers(String),
    /// A member has no ML-KEM-1024 key registered, so the chain would refuse
    /// any envelope.
    #[error("member {0} has no ML-KEM-1024 key registered")]
    NoKemKey(String),
}
