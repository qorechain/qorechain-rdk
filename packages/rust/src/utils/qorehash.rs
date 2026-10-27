//! QoreChain's default hash: SHAKE-256 with a 32-byte output (the chain's
//! `qorehash.Sum256`). Merkle nodes, withdrawal leaves, DA blob commitments and
//! transition roots all use it.

/// SHAKE-256 of the concatenation of `parts`, 32 bytes.
pub fn qorehash(parts: &[&[u8]]) -> [u8; 32] {
    if let [one] = parts {
        return qorechain_pqc::shake256(one);
    }
    qorechain_pqc::shake256(&parts.concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concatenates_its_parts() {
        assert_eq!(qorehash(&[b"ab", b"c"]), qorehash(&[b"abc"]));
        assert_eq!(qorehash(&[]), qorehash(&[b""]));
        // SHAKE-256("abc"), 32 bytes.
        assert_eq!(
            hex::encode(qorehash(&[b"abc"])),
            "483366601360a8771c6863080cc4114d8db44530f8f1e1ee4f94ea37e78b5739"
        );
    }
}
