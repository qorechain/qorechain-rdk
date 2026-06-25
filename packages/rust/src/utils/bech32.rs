//! Bech32 <-> hex conversion for QoreChain addresses.

use crate::constants::ACCOUNT_PREFIX;
use bech32::{Bech32, Hrp};
use thiserror::Error;

use super::bytes::hex_to_bytes;

/// A bech32 conversion error.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum Bech32Error {
    /// The address could not be decoded.
    #[error("invalid bech32 address: {0}")]
    Decode(String),
    /// The prefix was not a valid HRP.
    #[error("invalid bech32 prefix: {0}")]
    Prefix(String),
    /// The data could not be encoded.
    #[error("bech32 encode failed: {0}")]
    Encode(String),
    /// The hex data was invalid.
    #[error("invalid hex data: {0}")]
    Hex(String),
}

/// Decode a bech32 address to a `0x`-prefixed hex string of its data bytes.
pub fn bech32_to_hex(address: &str) -> Result<String, Bech32Error> {
    let (_hrp, data) = bech32::decode(address).map_err(|e| Bech32Error::Decode(e.to_string()))?;
    Ok(format!("0x{}", hex::encode(data)))
}

/// Encode hex data bytes as a bech32 address with the given prefix.
pub fn hex_to_bech32(hex_str: &str, prefix: &str) -> Result<String, Bech32Error> {
    let bytes = hex_to_bytes(hex_str).map_err(|e| Bech32Error::Hex(e.to_string()))?;
    let hrp = Hrp::parse(prefix).map_err(|e| Bech32Error::Prefix(e.to_string()))?;
    bech32::encode::<Bech32>(hrp, &bytes).map_err(|e| Bech32Error::Encode(e.to_string()))
}

/// Encode hex data bytes as a bech32 address with the default account prefix.
pub fn hex_to_bech32_default(hex_str: &str) -> Result<String, Bech32Error> {
    hex_to_bech32(hex_str, ACCOUNT_PREFIX)
}

/// Return the human-readable prefix of a bech32 address.
pub fn bech32_prefix(address: &str) -> Result<String, Bech32Error> {
    let (hrp, _data) = bech32::decode(address).map_err(|e| Bech32Error::Decode(e.to_string()))?;
    Ok(hrp.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let addr = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h";
        let hex = bech32_to_hex(addr).unwrap();
        assert!(hex.starts_with("0x"));
        let back = hex_to_bech32(&hex, "qor").unwrap();
        assert_eq!(back, addr);
        assert_eq!(bech32_prefix(addr).unwrap(), "qor");
    }
}
