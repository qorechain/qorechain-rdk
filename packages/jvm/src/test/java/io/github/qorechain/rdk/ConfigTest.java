package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SequencerMode;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import io.github.qorechain.rdk.config.Matrix;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.config.Validate;
import io.github.qorechain.rdk.config.ValidationResult;
import io.github.qorechain.rdk.presets.Presets;
import java.util.List;
import org.junit.jupiter.api.Test;

class ConfigTest {

    @Test
    void matrixMatchesChainRules() {
        assertEquals(List.of(ProofSystem.FRAUD), Matrix.validProofSystems(SettlementParadigm.OPTIMISTIC));
        assertEquals(
                List.of(ProofSystem.SNARK, ProofSystem.STARK),
                Matrix.validProofSystems(SettlementParadigm.ZK));
        assertEquals(List.of(ProofSystem.NONE), Matrix.validProofSystems(SettlementParadigm.BASED));
        assertEquals(List.of(ProofSystem.NONE), Matrix.validProofSystems(SettlementParadigm.SOVEREIGN));

        assertTrue(Matrix.isProofCompatible(SettlementParadigm.ZK, ProofSystem.SNARK));
        assertFalse(Matrix.isProofCompatible(SettlementParadigm.ZK, ProofSystem.FRAUD));
        assertTrue(Matrix.requiresBasedSequencer(SettlementParadigm.BASED));
        assertFalse(Matrix.requiresBasedSequencer(SettlementParadigm.OPTIMISTIC));
    }

    @Test
    void validateAcceptsAValidPreset() {
        RollupConfig config = Presets.defi(c -> c.rollupId = "ok").get();
        ValidationResult r = Validate.validateRollupConfig(config);
        assertTrue(r.valid, () -> "errors: " + r.errors);
    }

    @Test
    void validateRejectsAnIncompatibleProofPair() {
        RollupConfig config = Presets.defi(c -> c.rollupId = "bad").get();
        config.proofSystem = ProofSystem.FRAUD; // zk settlement requires snark|stark
        ValidationResult r = Validate.validateRollupConfig(config);
        assertFalse(r.valid);
        assertTrue(r.errors.stream().anyMatch(e -> e.contains("not compatible")));
    }

    @Test
    void validateEnforcesBasedSequencerForBasedSettlement() {
        RollupConfig config = Presets.gaming(c -> c.rollupId = "g").get();
        config.sequencer = SequencerMode.DEDICATED; // based settlement requires based sequencer
        ValidationResult r = Validate.validateRollupConfig(config);
        assertFalse(r.valid);
        assertTrue(r.errors.stream().anyMatch(e -> e.contains("based settlement requires")));
    }

    @Test
    void validateWarnsOnCelestia() {
        RollupConfig config = Presets.nft(c -> c.rollupId = "n").get();
        ValidationResult r = Validate.validateRollupConfig(config);
        assertTrue(r.valid, () -> "errors: " + r.errors);
        assertTrue(r.warnings.stream().anyMatch(w -> w.contains("Celestia")));
    }

    @Test
    void validateRejectsEmptyRollupId() {
        RollupConfig config = Presets.defi(null).get();
        ValidationResult r = Validate.validateRollupConfig(config);
        assertFalse(r.valid);
        assertTrue(r.errors.stream().anyMatch(e -> e.contains("rollupId")));
    }
}
