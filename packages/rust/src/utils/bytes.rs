//! Byte/hex helpers used across the tx, bridge, and event layers.

use thiserror::Error;

/// An invalid hex string.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("invalid hex string: \"{0}\"")]
pub struct HexError(pub String);

/// Convert bytes to a lowercase hex string (no `0x` prefix).
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

/// Parse a hex string (with or without a `0x` prefix) into bytes.
pub fn hex_to_bytes(input: &str) -> Result<Vec<u8>, HexError> {
    let h = input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))
        .unwrap_or(input);
    hex::decode(h).map_err(|_| HexError(input.to_string()))
}

/// Coerce a hex string into bytes (identity for already-decoded byte slices is
/// handled by the caller).
pub fn to_bytes(input: &str) -> Result<Vec<u8>, HexError> {
    hex_to_bytes(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        assert_eq!(bytes_to_hex(&[1, 2, 0xff]), "0102ff");
        assert_eq!(hex_to_bytes("0x0102FF").unwrap(), vec![1, 2, 0xff]);
        assert!(hex_to_bytes("xyz").is_err());
        assert!(hex_to_bytes("abc").is_err());
    }
}
