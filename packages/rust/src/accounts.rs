//! Account and signing helpers.
//!
//! Derives a native account from a BIP-39 mnemonic along the Cosmos BIP-44 path
//! `m/44'/118'/0'/0/0`, exposes a [`Signer`] abstraction over a secp256k1
//! signing key, and re-derives the bech32 `qor` address from the public key.

use bip32::DerivationPath;
use cosmrs::crypto::secp256k1::SigningKey;
use cosmrs::crypto::PublicKey;
use hmac::Hmac;
use sha2::Sha512;
use thiserror::Error;

use crate::constants::ACCOUNT_PREFIX;

/// The Cosmos BIP-44 derivation path (`m/44'/118'/0'/0/0`).
pub const COSMOS_DERIVATION_PATH: &str = "m/44'/118'/0'/0/0";

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
}

/// A derived native account: its signing key and bech32 `qor` address.
pub struct NativeAccount {
    signing_key: SigningKey,
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
        let signing_key = SigningKey::derive_from_path(seed, &path)
            .map_err(|e| AccountError::Derivation(e.to_string()))?;
        let address = signing_key
            .public_key()
            .account_id(prefix)
            .map_err(|e| AccountError::Address(e.to_string()))?
            .to_string();
        Ok(NativeAccount {
            signing_key,
            address,
        })
    }

    /// Derive a native account using the default `qor` prefix.
    pub fn from_mnemonic_default(phrase: &str) -> Result<Self, AccountError> {
        Self::from_mnemonic(phrase, ACCOUNT_PREFIX)
    }

    /// Build a native account from a raw 32-byte secp256k1 private key.
    pub fn from_private_key(bytes: &[u8], prefix: &str) -> Result<Self, AccountError> {
        let signing_key =
            SigningKey::from_slice(bytes).map_err(|e| AccountError::Derivation(e.to_string()))?;
        let address = signing_key
            .public_key()
            .account_id(prefix)
            .map_err(|e| AccountError::Address(e.to_string()))?
            .to_string();
        Ok(NativeAccount {
            signing_key,
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
}

impl Signer for NativeAccount {
    fn address(&self) -> &str {
        &self.address
    }
    fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }
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
