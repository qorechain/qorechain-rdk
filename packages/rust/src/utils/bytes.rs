//! Byte/hex helpers used across the tx, bridge, and event layers.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
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

/// Decode standard (RFC 4648) base64 into bytes.
pub fn base64_to_bytes(b64: &str) -> Result<Vec<u8>, HexError> {
    if b64.is_empty() {
        return Ok(Vec::new());
    }
    BASE64.decode(b64).map_err(|_| HexError(b64.to_string()))
}

/// Decode a bytes value as it arrives from the chain's wire surface. Cosmos
/// gRPC-gateway (jsonpb) encodes proto `bytes` as base64; some surfaces send
/// hex. Disambiguated by alphabet and length (a 32-byte root is 64 hex chars vs
/// ~44 base64 chars with `+/=`), so both encodings round-trip correctly.
pub fn decode_wire_bytes(value: &str) -> Vec<u8> {
    if value.is_empty() {
        return Vec::new();
    }
    let is_hex = value.len().is_multiple_of(2) && value.bytes().all(|b| b.is_ascii_hexdigit());
    let looks_base64 = value
        .bytes()
        .any(|b| matches!(b, b'+' | b'/' | b'=') || matches!(b, b'g'..=b'z' | b'G'..=b'Z'));
    if is_hex && !looks_base64 {
        hex_to_bytes(value).unwrap_or_default()
    } else {
        base64_to_bytes(value).unwrap_or_default()
    }
}

/// Normalize a wire bytes field (base64 or hex) to a lowercase hex string.
pub fn hex_bytes(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        bytes_to_hex(&decode_wire_bytes(value))
    }
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
