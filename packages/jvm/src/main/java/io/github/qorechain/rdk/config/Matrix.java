package io.github.qorechain.rdk.config;

import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * The settlement → proof-system compatibility matrix enforced by the chain:
 *
 * <ul>
 *   <li>{@code optimistic} → {@code fraud}
 *   <li>{@code zk} → {@code snark} | {@code stark}
 *   <li>{@code based} → {@code none}
 *   <li>{@code sovereign} → {@code none}
 * </ul>
 */
public final class Matrix {
    private Matrix() {}

    /** The settlement → valid proof systems mapping. */
    public static final Map<SettlementParadigm, List<ProofSystem>> SETTLEMENT_PROOF_MATRIX;

    static {
        Map<SettlementParadigm, List<ProofSystem>> m = new EnumMap<>(SettlementParadigm.class);
        m.put(SettlementParadigm.OPTIMISTIC, List.of(ProofSystem.FRAUD));
        m.put(SettlementParadigm.ZK, List.of(ProofSystem.SNARK, ProofSystem.STARK));
        m.put(SettlementParadigm.BASED, List.of(ProofSystem.NONE));
        m.put(SettlementParadigm.SOVEREIGN, List.of(ProofSystem.NONE));
        SETTLEMENT_PROOF_MATRIX = Collections.unmodifiableMap(m);
    }

    /** Returns the proof systems valid for a settlement paradigm. */
    public static List<ProofSystem> validProofSystems(SettlementParadigm settlement) {
        List<ProofSystem> list = SETTLEMENT_PROOF_MATRIX.get(settlement);
        return list == null ? Collections.emptyList() : list;
    }

    /** Whether a proof system is compatible with a settlement paradigm. */
    public static boolean isProofCompatible(SettlementParadigm settlement, ProofSystem proof) {
        return validProofSystems(settlement).contains(proof);
    }

    /**
     * Whether a settlement paradigm requires the {@code based} sequencer mode. Only {@code based}
     * settlement carries this constraint.
     */
    public static boolean requiresBasedSequencer(SettlementParadigm settlement) {
        return settlement == SettlementParadigm.BASED;
    }
}
