//! Account and signing helpers.
//!
//! Derives a native account from a BIP-39 mnemonic along the Cosmos BIP-44 path
//! `m/44'/118'/0'/0/0`, exposes a [`Signer`] abstraction over a secp256k1
//! signing key, and re-derives the bech32 `qor` address from the public key.
//!
//! For hybrid (post-quantum) signing it also finds the ML-DSA-87 keypair an
//! account actually uses ([`resolve_pqc_keypair`], [`pqc_keypair_from_env`]),
//! with the QoreChain SDK's canonical and legacy derivations.

use bip32::{DerivationPath, XPrv};
use cosmrs::crypto::secp256k1::SigningKey;
use cosmrs::crypto::PublicKey;
use hmac::Hmac;
use sha2::Sha512;
use thiserror::Error;

use crate::client::RdkClient;
use crate::constants::ACCOUNT_PREFIX;
use crate::utils::bytes::{bytes_to_hex, hex_to_bytes};

pub use qorechain::authenticator::{derive_pqc_canonical, derive_pqc_legacy};
pub use qorechain::pqc::{pqc_keypair_from_seed, PqcKeypair};

/// The Cosmos BIP-44 derivation path (`m/44'/118'/0'/0/0`).
pub const COSMOS_DERIVATION_PATH: &str = "m/44'/118'/0'/0/0";

/// Environment variable holding an operator's hex-encoded secp256k1 private key.
pub const ENV_OPERATOR_PRIVATE_KEY_HEX: &str = "QORE_OPERATOR_PRIVATE_KEY_HEX";

/// Environment variable holding an operator's BIP-39 mnemonic.
pub const ENV_MNEMONIC: &str = "QORE_MNEMONIC";

/// Environment variable holding an operator's hex-encoded 32-byte ML-DSA-87
/// seed, for an operator who signs with a raw private key and so has no
/// mnemonic to derive the post-quantum key from.
pub const ENV_PQC_SEED_HEX: &str = "QORE_PQC_SEED_HEX";

/// Derive the BIP-39 seed from a mnemonic and optional passphrase.
///
/// Implements the BIP-39 seed step directly (PBKDF2-HMAC-SHA512, 2048
/// iterations, salt `"mnemonic" + passphrase`) so that the standard 12-, 15-,
/// 18-, 21-, and 24-word phrases are all supported.
fn bip39_seed(phrase: &str, passphrase: &str) -> [u8; 64] {
    let normalized = phrase.split_whitespace().collect::<Vec<_>>().join(" ");
    let salt = format!("mnemonic{passphrase}");
    let mut seed = [0u8; 64];
    pbkdf2::pbkdf2::<Hmac<Sha512>>(normalized.as_bytes(), salt.as_bytes(), 2048, &mut seed)
        .expect("HMAC accepts any key length");
    seed
}

/// A light validity check: a BIP-39 phrase has 12/15/18/21/24 lowercase words.
fn looks_like_mnemonic(phrase: &str) -> bool {
    let words: Vec<&str> = phrase.split_whitespace().collect();
    matches!(words.len(), 12 | 15 | 18 | 21 | 24)
        && words
            .iter()
            .all(|w| w.chars().all(|c| c.is_ascii_lowercase()))
}

/// An account-derivation or signing error.
#[derive(Debug, Error)]
pub enum AccountError {
    /// The mnemonic phrase was invalid.
    #[error("invalid mnemonic: {0}")]
    Mnemonic(String),
    /// Key derivation failed.
    #[error("key derivation failed: {0}")]
    Derivation(String),
    /// Building the bech32 address failed.
    #[error("address derivation failed: {0}")]
    Address(String),
    /// Signing failed.
    #[error("signing failed: {0}")]
    Sign(String),
    /// The post-quantum keypair could not be resolved.
    #[error("{0}")]
    Pqc(String),
}

/// A derived native account: its signing key and bech32 `qor` address.
pub struct NativeAccount {
    signing_key: SigningKey,
    private_key: [u8; 32],
    address: String,
}

impl NativeAccount {
    /// Derive a native account from a BIP-39 English mnemonic along the Cosmos
    /// BIP-44 path with the given bech32 prefix.
    pub fn from_mnemonic(phrase: &str, prefix: &str) -> Result<Self, AccountError> {
        let phrase = phrase.trim();
        if !looks_like_mnemonic(phrase) {
            return Err(AccountError::Mnemonic(
                "expected 12/15/18/21/24 lowercase words".to_string(),
            ));
        }
        let seed = bip39_seed(phrase, "");
        let path: DerivationPath = COSMOS_DERIVATION_PATH
            .parse()
            .map_err(|e: bip32::Error| AccountError::Derivation(e.to_string()))?;
        let xprv = XPrv::derive_from_path(seed, &path)
            .map_err(|e| AccountError::Derivation(e.to_string()))?;
        Self::from_private_key(&xprv.to_bytes(), prefix)
    }

    /// Derive a native account using the default `qor` prefix.
    pub fn from_mnemonic_default(phrase: &str) -> Result<Self, AccountError> {
        Self::from_mnemonic(phrase, ACCOUNT_PREFIX)
    }

    /// Build a native account from a raw 32-byte secp256k1 private key.
    pub fn from_private_key(bytes: &[u8], prefix: &str) -> Result<Self, AccountError> {
        let signing_key =
            SigningKey::from_slice(bytes).map_err(|e| AccountError::Derivation(e.to_string()))?;
        // `from_slice` accepted the key, so it is at most 32 bytes; a shorter
        // one is left-padded, as the scalar it denotes.
        let mut private_key = [0u8; 32];
        private_key[32 - bytes.len()..].copy_from_slice(bytes);
        let address = signing_key
            .public_key()
            .account_id(prefix)
            .map_err(|e| AccountError::Address(e.to_string()))?
            .to_string();
        Ok(NativeAccount {
            signing_key,
            private_key,
            address,
        })
    }

    /// The bech32 account address.
    pub fn address(&self) -> &str {
        &self.address
    }

    /// The account's public key.
    pub fn public_key(&self) -> PublicKey {
        self.signing_key.public_key()
    }

    /// Borrow the signing key (for use with the tx client).
    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    /// Consume the account, returning its signing key.
    pub fn into_signing_key(self) -> SigningKey {
        self.signing_key
    }

    /// Sign an arbitrary message, returning the raw signature bytes.
    pub fn sign(&self, msg: &[u8]) -> Result<Vec<u8>, AccountError> {
        self.signing_key
            .sign(msg)
            .map(|sig| sig.to_vec())
            .map_err(|e| AccountError::Sign(e.to_string()))
    }
}

/// A minimal signer abstraction the tx client depends on.
pub trait Signer {
    /// The signer's bech32 address.
    fn address(&self) -> &str;
    /// Borrow the underlying secp256k1 signing key.
    fn signing_key(&self) -> &SigningKey;
    /// The signer's public key.
    fn public_key(&self) -> PublicKey {
        self.signing_key().public_key()
    }
    /// The raw 32-byte secp256k1 private key, which hybrid (post-quantum)
    /// signing needs to sign the classical half. `None` (the default) means the
    /// signer cannot sign hybrid; it can still sign classical-only.
    fn private_key_bytes(&self) -> Option<[u8; 32]> {
        None
    }
}

impl Signer for NativeAccount {
    fn address(&self) -> &str {
        &self.address
    }
    fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }
    fn private_key_bytes(&self) -> Option<[u8; 32]> {
        Some(self.private_key)
    }
}

/// Build a signer from the process environment, preferring a hex private key
/// (`QORE_OPERATOR_PRIVATE_KEY_HEX`) over a mnemonic (`QORE_MNEMONIC`), using the
/// default `qor` prefix.
///
/// Returns `Ok(None)` when neither variable is set, so callers can give a
/// friendly message; `Err` when a value is present but invalid.
pub fn signer_from_env() -> Result<Option<NativeAccount>, AccountError> {
    signer_from_env_with(|key| std::env::var(key).ok(), ACCOUNT_PREFIX)
}

/// Like [`signer_from_env`] but with an injectable env lookup and bech32 prefix,
/// for testing and non-`std::env` environments. The lookup returns the value for
/// a variable name, or `None` if unset.
pub fn signer_from_env_with(
    lookup: impl Fn(&str) -> Option<String>,
    prefix: &str,
) -> Result<Option<NativeAccount>, AccountError> {
    if let Some(hex) = lookup(ENV_OPERATOR_PRIVATE_KEY_HEX) {
        let hex = hex.trim();
        if !hex.is_empty() {
            let bytes = hex_to_bytes(hex).map_err(|e| AccountError::Derivation(e.to_string()))?;
            return NativeAccount::from_private_key(&bytes, prefix).map(Some);
        }
    }
    if let Some(mnemonic) = lookup(ENV_MNEMONIC) {
        let mnemonic = mnemonic.trim();
        if !mnemonic.is_empty() {
            return NativeAccount::from_mnemonic(mnemonic, prefix).map(Some);
        }
    }
    Ok(None)
}

/// Which derivation produced an operator's post-quantum key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PqcDerivation {
    /// The address-bound derivation:
    /// `shake256("qorechain:pqc:v1|" + account + "|" + mnemonic)`.
    Canonical,
    /// The older chain-bridge derivation: `shake256(mnemonic)`.
    Legacy,
    /// An explicit 32-byte seed (`QORE_PQC_SEED_HEX`).
    Seed,
}

/// The outcome of [`resolve_pqc_keypair`] / [`pqc_keypair_from_env`].
#[derive(Clone)]
pub struct ResolvedPqcKeypair {
    /// The ML-DSA-87 keypair to sign with.
    pub keypair: PqcKeypair,
    /// Which derivation produced it.
    pub derivation: PqcDerivation,
    /// The chain already holds this key for the account.
    pub registered: bool,
    /// Pass this as `include_pqc_public_key` to the tx client: true when the
    /// account has no key on chain yet, so the first hybrid transaction
    /// registers it.
    pub include_pqc_public_key: bool,
}

impl std::fmt::Debug for ResolvedPqcKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print the secret key.
        f.debug_struct("ResolvedPqcKeypair")
            .field("public_key", &bytes_to_hex(&self.keypair.public_key))
            .field("derivation", &self.derivation)
            .field("registered", &self.registered)
            .field("include_pqc_public_key", &self.include_pqc_public_key)
            .finish()
    }
}

/// Find the ML-DSA-87 keypair an account actually uses, by asking the chain.
///
/// A mnemonic can yield two post-quantum keys, and a wallet may have registered
/// either: the **canonical** one (address-bound --
/// `shake256("qorechain:pqc:v1|" + account + "|" + mnemonic)`, what unified
/// accounts use) or the **legacy** one (the older chain-bridge scheme). Signing
/// with the wrong one is not a soft failure: the hybrid signature would not
/// match the registered key and every transaction would be refused. So this
/// derives both and returns whichever the chain has registered.
///
/// - If the account has **no** key registered, it returns the canonical key
///   with `include_pqc_public_key: true`, so the first transaction registers it.
/// - If the account has a key that **neither** derivation produces, it fails:
///   the key was registered from another secret, and guessing would only cost a
///   refused transaction. Supply that keypair explicitly instead.
pub fn resolve_pqc_keypair(
    client: &RdkClient,
    address: &str,
    mnemonic: &str,
) -> Result<ResolvedPqcKeypair, AccountError> {
    let canonical = derive_pqc_canonical(address, mnemonic);
    let legacy = derive_pqc_legacy(mnemonic);
    let registered_key = registered_pqc_key(client, address);

    if registered_key.is_empty() {
        return Ok(resolved(canonical, PqcDerivation::Canonical, false));
    }
    if registered_key == bytes_to_hex(&canonical.public_key) {
        return Ok(resolved(canonical, PqcDerivation::Canonical, true));
    }
    if registered_key == bytes_to_hex(&legacy.public_key) {
        return Ok(resolved(legacy, PqcDerivation::Legacy, true));
    }
    Err(AccountError::Pqc(format!(
        "account {address} has a post-quantum key on chain that neither the canonical nor the legacy \
         derivation of this mnemonic produces, so it was registered from another secret. Supply that \
         keypair explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this account."
    )))
}

/// The operator's ML-DSA-87 keypair from the process environment, checked
/// against the chain, or `Ok(None)` when no source is configured (the caller
/// then signs classical-only, which both public networks refuse on the native
/// lane).
///
/// - `QORE_PQC_SEED_HEX` -- a 32-byte ML-DSA-87 seed, for an operator who signs
///   with a raw private key (`QORE_OPERATOR_PRIVATE_KEY_HEX`) and so has no
///   mnemonic to derive from. Takes precedence when set. Still checked against
///   the chain, and refused if the account holds a different key.
/// - `QORE_MNEMONIC` -- resolved with [`resolve_pqc_keypair`]: whichever of the
///   canonical and legacy derivations the chain has registered.
pub fn pqc_keypair_from_env(
    client: &RdkClient,
    address: &str,
) -> Result<Option<ResolvedPqcKeypair>, AccountError> {
    pqc_keypair_from_env_with(client, address, |key| std::env::var(key).ok())
}

/// Like [`pqc_keypair_from_env`] but with an injectable env lookup, for testing
/// and non-`std::env` environments. The lookup returns the value for a variable
/// name, or `None` if unset.
pub fn pqc_keypair_from_env_with(
    client: &RdkClient,
    address: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<Option<ResolvedPqcKeypair>, AccountError> {
    if let Some(seed_hex) = lookup(ENV_PQC_SEED_HEX) {
        let seed_hex = seed_hex.trim();
        if !seed_hex.is_empty() {
            let seed = hex_to_bytes(seed_hex).map_err(|e| AccountError::Pqc(e.to_string()))?;
            let seed: [u8; 32] = seed.as_slice().try_into().map_err(|_| {
                AccountError::Pqc(format!(
                    "QORE_PQC_SEED_HEX must be 32 bytes, got {}",
                    seed.len()
                ))
            })?;
            let keypair = pqc_keypair_from_seed(&seed);
            let registered_key = registered_pqc_key(client, address);
            if registered_key.is_empty() {
                return Ok(Some(resolved(keypair, PqcDerivation::Seed, false)));
            }
            if registered_key == bytes_to_hex(&keypair.public_key) {
                return Ok(Some(resolved(keypair, PqcDerivation::Seed, true)));
            }
            return Err(AccountError::Pqc(format!(
                "QORE_PQC_SEED_HEX does not produce the post-quantum key registered for {address}; \
                 every hybrid transaction signed with it would be refused"
            )));
        }
    }
    if let Some(mnemonic) = lookup(ENV_MNEMONIC) {
        let mnemonic = mnemonic.trim();
        if !mnemonic.is_empty() {
            return resolve_pqc_keypair(client, address, mnemonic).map(Some);
        }
    }
    Ok(None)
}

fn resolved(
    keypair: PqcKeypair,
    derivation: PqcDerivation,
    registered: bool,
) -> ResolvedPqcKeypair {
    ResolvedPqcKeypair {
        keypair,
        derivation,
        registered,
        include_pqc_public_key: !registered,
    }
}

/// The account's registered ML-DSA-87 public key as lowercase hex, or `""`
/// when it has none.
fn registered_pqc_key(client: &RdkClient, address: &str) -> String {
    // An account with no record reads as "not registered".
    client
        .rest
        .get_pqc_account(address)
        .map(|view| view.public_key.to_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOLDEN_MNEMONIC: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn derives_golden_address() {
        let acct = NativeAccount::from_mnemonic_default(GOLDEN_MNEMONIC).unwrap();
        assert_eq!(acct.address(), "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h");
    }
}
