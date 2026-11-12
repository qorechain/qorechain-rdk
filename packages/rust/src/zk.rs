//! ZK public inputs as the chain checks them (chain v3.2.8+,
//! `rdk-zk-canonical-inputs`).
//!
//! A Groth16 batch is verified with four public inputs, in order:
//! `prev_state_root`, `state_root`, `data_hash`, `withdrawals_root`, each read
//! as a big-endian integer. From v3.2.8 the chain no longer reduces a
//! submitter-chosen input into the BLS12-381 scalar field: it refuses the batch
//! unless the value is already below the scalar modulus `r`. A raw SHA-256 or
//! SHAKE-256 output is at or above `r` about 55% of the time.
//!
//! - `prev_state_root` and `state_root` are always checked. Commit to state
//!   with a field-friendly hash, or reduce with [`to_canonical_scalar`] and
//!   prove the reduced value.
//! - `data_hash` is not checked when the chain fixed it itself: a based
//!   rollup's inbox range commitment, or a native-DA batch whose hash names a
//!   posted or stored blob ([`is_data_hash_chain_bound`]). Otherwise it must be
//!   canonical.
//! - `withdrawals_root` may be any 32 bytes: the chain stores it reduced
//!   modulo `r` and checks withdrawals against it modulo `r`
//!   ([`withdrawals_root_matches`]). The circuit's fourth input is
//!   `int(withdrawals_root) mod r` ([`zk_public_inputs`]).
//!
//! Values are compared as 32-byte big-endian integers; no big-integer library
//! is needed.

/// The BLS12-381 scalar field modulus `r`, 32 bytes big-endian.
pub const BLS12_381_SCALAR_MODULUS: [u8; 32] = [
    0x73, 0xed, 0xa7, 0x53, 0x29, 0x9d, 0x7d, 0x48, 0x33, 0x39, 0xd8, 0x08, 0x09, 0xa1, 0xd8, 0x05,
    0x53, 0xbd, 0xa4, 0x02, 0xff, 0xfe, 0x5b, 0xfe, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01,
];

/// `value` without its leading zero bytes.
fn trim_leading_zeros(value: &[u8]) -> &[u8] {
    let start = value.iter().position(|&b| b != 0).unwrap_or(value.len());
    &value[start..]
}

/// Whether a big-endian value (any length; empty reads as 0) is a canonical
/// BLS12-381 scalar, strictly below `r`.
pub fn is_canonical_scalar(value: &[u8]) -> bool {
    let v = trim_leading_zeros(value);
    if v.len() > 32 {
        return false;
    }
    let mut padded = [0u8; 32];
    padded[32 - v.len()..].copy_from_slice(v);
    padded < BLS12_381_SCALAR_MODULUS
}

/// `a - b` in place, for 32-byte big-endian values with `a >= b`.
fn sub_in_place(a: &mut [u8; 32], b: &[u8; 32]) {
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut d = a[i] as i16 - b[i] as i16 - borrow;
        if d < 0 {
            d += 256;
            borrow = 1;
        } else {
            borrow = 0;
        }
        a[i] = d as u8;
    }
}

/// Reduce a big-endian value (any length) modulo `r` and return it as 32
/// big-endian bytes. Use it for values the rollup chooses (state roots, an
/// unbound data hash), and prove the reduced value in the circuit.
pub fn to_canonical_scalar(value: &[u8]) -> [u8; 32] {
    // Bitwise long division: acc = acc * 2 + bit, then subtract r once if
    // acc >= r. acc stays below r < 2^255, so acc * 2 + 1 fits in 32 bytes.
    let mut acc = [0u8; 32];
    for &byte in trim_leading_zeros(value) {
        for bit in (0..8).rev() {
            let mut carry = (byte >> bit) & 1;
            for b in acc.iter_mut().rev() {
                let next = *b >> 7;
                *b = (*b << 1) | carry;
                carry = next;
            }
            if acc >= BLS12_381_SCALAR_MODULUS {
                sub_in_place(&mut acc, &BLS12_381_SCALAR_MODULUS);
            }
        }
    }
    acc
}

/// The public inputs of a zk batch, as they go into `MsgSubmitBatch`. An empty
/// field reads as 0 (canonical).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ZkBatchInputs<'a> {
    /// The previous state root.
    pub prev_state_root: &'a [u8],
    /// The post-state root.
    pub state_root: &'a [u8],
    /// The batch's data hash.
    pub data_hash: &'a [u8],
    /// The withdrawals tree root.
    pub withdrawals_root: &'a [u8],
}

/// Why the chain would refuse a zk (snark) batch's public inputs as not
/// canonical, one message per input; empty when they are all accepted.
///
/// `data_hash_bound`: the chain fixed `data_hash` itself (see
/// [`is_data_hash_chain_bound`]), so it is not checked.
pub fn zk_public_input_errors(inputs: &ZkBatchInputs<'_>, data_hash_bound: bool) -> Vec<String> {
    let mut checks: Vec<(&str, &[u8])> = vec![
        ("prev_state_root", inputs.prev_state_root),
        ("state_root", inputs.state_root),
    ];
    if !data_hash_bound {
        checks.push(("data_hash", inputs.data_hash));
    }
    let mut errors = Vec::new();
    for (name, v) in checks {
        if !is_canonical_scalar(v) {
            errors.push(format!(
                "{name} is not a canonical BLS12-381 scalar (it must be below r): reduce it with \
                 to_canonical_scalar and prove the reduced value"
            ));
        }
    }
    errors
}

/// The four public inputs of a Groth16 rollup circuit, in the chain's order
/// (`prev_state_root`, `state_root`, `data_hash`, `withdrawals_root`), each the
/// big-endian value reduced modulo `r`, 32 bytes. An empty value is 0. Use
/// them as the circuit's public witness.
pub fn zk_public_inputs(inputs: &ZkBatchInputs<'_>) -> [[u8; 32]; 4] {
    [
        to_canonical_scalar(inputs.prev_state_root),
        to_canonical_scalar(inputs.state_root),
        to_canonical_scalar(inputs.data_hash),
        to_canonical_scalar(inputs.withdrawals_root),
    ]
}

/// Whether a withdrawals tree root matches a batch's stored root, as the
/// chain checks a withdrawal: modulo `r` when the batch's
/// `withdrawals_root_reduced` is set (chain v3.2.8+ Groth16 batches), byte for
/// byte otherwise.
pub fn withdrawals_root_matches(
    stored_root: &[u8],
    tree_root: &[u8],
    withdrawals_root_reduced: bool,
) -> bool {
    if withdrawals_root_reduced {
        return to_canonical_scalar(stored_root) == to_canonical_scalar(tree_root);
    }
    stored_root == tree_root
}

/// Whether the chain fixes a batch's `data_hash` itself, so it is exempt from
/// the canonical check: always on a based rollup (the inbox range commitment),
/// and on a `native` or `both` DA rollup when the hash is non-empty (the chain
/// then requires a posted or stored blob with exactly that hash).
pub fn is_data_hash_chain_bound(da_backend: &str, sequencing: &str, data_hash: &[u8]) -> bool {
    if sequencing == "based" {
        return true;
    }
    !data_hash.is_empty() && (da_backend == "native" || da_backend == "both")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduces_values_longer_than_32_bytes() {
        // r itself, with a leading zero byte, is 0 mod r.
        let mut r = vec![0u8];
        r.extend_from_slice(&BLS12_381_SCALAR_MODULUS);
        assert_eq!(to_canonical_scalar(&r), [0u8; 32]);
        assert!(!is_canonical_scalar(&[1u8; 33]));
        assert!(is_canonical_scalar(&[]));
    }
}
