"""The settlement -> proof-system compatibility matrix enforced by the chain.

- ``optimistic`` -> ``fraud``
- ``zk`` -> ``snark`` | ``stark``
- ``based`` -> ``none``
- ``sovereign`` -> ``none``
"""

from __future__ import annotations

from ..enums import ProofSystem, SettlementParadigm

#: Settlement paradigm to the proof systems it accepts.
SETTLEMENT_PROOF_MATRIX: dict[SettlementParadigm, tuple[ProofSystem, ...]] = {
    SettlementParadigm.OPTIMISTIC: (ProofSystem.FRAUD,),
    SettlementParadigm.ZK: (ProofSystem.SNARK, ProofSystem.STARK),
    SettlementParadigm.BASED: (ProofSystem.NONE,),
    SettlementParadigm.SOVEREIGN: (ProofSystem.NONE,),
}


def valid_proof_systems(
    settlement: SettlementParadigm,
) -> tuple[ProofSystem, ...]:
    """Return the proof systems valid for a settlement paradigm."""
    return SETTLEMENT_PROOF_MATRIX[SettlementParadigm(settlement)]


def is_proof_compatible(
    settlement: SettlementParadigm, proof: ProofSystem
) -> bool:
    """Whether a proof system is compatible with a settlement paradigm."""
    return ProofSystem(proof) in SETTLEMENT_PROOF_MATRIX[SettlementParadigm(settlement)]


def requires_based_sequencer(settlement: SettlementParadigm) -> bool:
    """Whether a settlement paradigm requires the ``based`` sequencer mode."""
    return SettlementParadigm(settlement) == SettlementParadigm.BASED


__all__ = [
    "SETTLEMENT_PROOF_MATRIX",
    "valid_proof_systems",
    "is_proof_compatible",
    "requires_based_sequencer",
]
