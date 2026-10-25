//! Client-side copies of rules the chain enforces, so a transaction the chain
//! would refuse is caught **before** a fee is paid.
//!
//! The chain checks both rule sets in the keeper rather than in
//! `ValidateBasic` (tightening `ValidateBasic` would retroactively refuse what
//! historical blocks accepted), so it can only tell you after you have paid.
//! These mirror them exactly; where they disagree, the chain wins and this
//! module is the bug.

/// Shortest new rollup/layer id the chain accepts, in bytes.
pub const ID_MIN_LENGTH: usize = 3;
/// Longest new rollup/layer id the chain accepts, in bytes.
pub const ID_MAX_LENGTH: usize = 64;
/// The only denomination a rollup's escrow ledger can pay a withdrawal in.
pub const ROLLUP_ESCROW_DENOM: &str = "uqor";
/// A batch commits at most 2^64 withdrawals, so a longer path never verifies.
pub const MAX_WITHDRAWAL_PROOF_DEPTH: usize = 64;

/// Why `id` breaks the chain's id grammar, or `None` if it does not.
///
/// From chain v3.2.2 a **new** rollup or layer id must match
/// `^[a-z0-9][a-z0-9._-]{2,63}$`, measured in bytes. Ids are store-key
/// components joined with `/`, so an id containing `/` (or sorting as another
/// id's extension) let one layer's anchors, batches or blobs be read as
/// another's. Ids created before v3.2.2 stay valid; this is for choosing a new
/// one. It is the chain's `IDGrammarError`, byte for byte.
pub fn rollup_id_error(id: &str) -> Option<String> {
    let bytes = id.as_bytes();
    if bytes.len() < ID_MIN_LENGTH || bytes.len() > ID_MAX_LENGTH {
        return Some(format!(
            "must be {ID_MIN_LENGTH} to {ID_MAX_LENGTH} characters"
        ));
    }
    for (i, &c) in bytes.iter().enumerate() {
        let lower_or_digit = c.is_ascii_lowercase() || c.is_ascii_digit();
        if lower_or_digit || (i > 0 && (c == b'.' || c == b'_' || c == b'-')) {
            continue;
        }
        return Some(if i == 0 {
            "must start with a lowercase letter or a digit".to_string()
        } else {
            "may contain only lowercase letters, digits, '.', '_' and '-'".to_string()
        });
    }
    None
}

/// Whether `id` is a valid new rollup/layer id.
pub fn is_valid_rollup_id(id: &str) -> bool {
    rollup_id_error(id).is_none()
}

/// Every reason the chain would refuse this withdrawal at the start of
/// `ExecuteWithdrawal` (chain v3.2.3+, `rdk-escrow-ledger`), or an empty list.
/// Mirrors `MsgExecuteWithdrawal.ValidateWithdrawal`.
pub fn withdrawal_errors(
    submitter: &str,
    rollup_id: &str,
    recipient: &str,
    denom: &str,
    amount: i64,
    proof: &[Vec<u8>],
) -> Vec<String> {
    let mut errors = Vec::new();
    if bech32::decode(submitter).is_err() {
        errors.push(format!("invalid submitter address \"{submitter}\""));
    }
    // Only emptiness: ids from before v3.2.2 may sit outside the grammar.
    if rollup_id.is_empty() {
        errors.push("rollup_id cannot be empty".to_string());
    }
    if bech32::decode(recipient).is_err() {
        errors.push(format!("invalid recipient address \"{recipient}\""));
    }
    if denom != ROLLUP_ESCROW_DENOM {
        errors.push(format!(
            "denom \"{denom}\": rollup escrow is held in {ROLLUP_ESCROW_DENOM} only"
        ));
    }
    if amount <= 0 {
        errors.push("amount must be positive".to_string());
    }
    if proof.len() > MAX_WITHDRAWAL_PROOF_DEPTH {
        errors.push(format!(
            "proof has {} levels, at most {MAX_WITHDRAWAL_PROOF_DEPTH}",
            proof.len()
        ));
    }
    for (i, sib) in proof.iter().enumerate() {
        if sib.len() != 32 {
            errors.push(format!("proof level {i} is {} bytes, want 32", sib.len()));
        }
    }
    errors
}

/// Why a batch with `data_hash` would be refused for a rollup on `da_backend`,
/// or `None` if the chain accepts it.
///
/// On a `native` or `both` rollup the chain accepts a non-empty `data_hash`
/// only when a matching blob is stored on chain, and no transaction stores one:
/// the batch is refused as data unavailable. Leave it empty there; the batch's
/// state roots and proof still bind it. (`celestia` is not checked by the
/// chain, and is not active on the network.)
pub fn data_hash_error(da_backend: &str, data_hash: &[u8]) -> Option<String> {
    if data_hash.is_empty() || (da_backend != "native" && da_backend != "both") {
        return None;
    }
    Some(format!(
        "data_hash must be empty on a rollup with {da_backend} data availability: no transaction \
         stores a data-availability blob on chain, so the chain refuses a batch that claims one"
    ))
}
