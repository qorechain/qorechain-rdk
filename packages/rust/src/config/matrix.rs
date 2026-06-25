//! The settlement -> proof-system compatibility matrix enforced by the chain.

use super::enums::{ProofSystem, Settlement};

/// The settlement -> proof-system compatibility matrix:
///
/// - `optimistic` -> `fraud`
/// - `zk` -> `snark` | `stark`
/// - `based` -> `none`
/// - `sovereign` -> `none`
pub const SETTLEMENT_PROOF_MATRIX: &[(Settlement, &[ProofSystem])] = &[
    (Settlement::Optimistic, &[ProofSystem::Fraud]),
    (Settlement::Zk, &[ProofSystem::Snark, ProofSystem::Stark]),
    (Settlement::Based, &[ProofSystem::None]),
    (Settlement::Sovereign, &[ProofSystem::None]),
];

/// Returns the proof systems valid for a settlement paradigm.
pub fn valid_proof_systems(settlement: Settlement) -> &'static [ProofSystem] {
    SETTLEMENT_PROOF_MATRIX
        .iter()
        .find(|(s, _)| *s == settlement)
        .map(|(_, proofs)| *proofs)
        .unwrap_or(&[])
}

/// Whether a proof system is compatible with a settlement paradigm.
pub fn is_proof_compatible(settlement: Settlement, proof: ProofSystem) -> bool {
    valid_proof_systems(settlement).contains(&proof)
}

/// Whether a settlement paradigm requires the `based` sequencer mode. Only
/// `based` settlement carries this constraint.
pub fn requires_based_sequencer(settlement: Settlement) -> bool {
    settlement == Settlement::Based
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_matches_chain_rules() {
        assert!(is_proof_compatible(
            Settlement::Optimistic,
            ProofSystem::Fraud
        ));
        assert!(!is_proof_compatible(
            Settlement::Optimistic,
            ProofSystem::Snark
        ));
        assert!(is_proof_compatible(Settlement::Zk, ProofSystem::Snark));
        assert!(is_proof_compatible(Settlement::Zk, ProofSystem::Stark));
        assert!(is_proof_compatible(Settlement::Based, ProofSystem::None));
        assert!(is_proof_compatible(
            Settlement::Sovereign,
            ProofSystem::None
        ));
        assert_eq!(valid_proof_systems(Settlement::Zk).len(), 2);
        assert!(requires_based_sequencer(Settlement::Based));
        assert!(!requires_based_sequencer(Settlement::Optimistic));
    }
}
