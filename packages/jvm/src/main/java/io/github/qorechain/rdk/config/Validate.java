package io.github.qorechain.rdk.config;

import io.github.qorechain.rdk.config.Enums.DABackend;
import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SequencerMode;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Validation of {@link RollupConfig} against the on-chain rules. */
public final class Validate {
    private Validate() {}

    private static final Pattern POSITIVE_INT = Pattern.compile("^[1-9][0-9]*$");

    private static boolean isPositiveIntegerString(String value) {
        return value != null && POSITIVE_INT.matcher(value).matches();
    }

    /**
     * Validate a rollup configuration against the on-chain rules: the settlement → proof
     * compatibility matrix, the based-settlement ⇒ based-sequencer constraint, the closed value
     * sets, and basic field sanity.
     *
     * <p>Returns a structured result; callers that prefer to fail fast can use
     * {@link #assertValidRollupConfig(RollupConfig)}.
     */
    public static ValidationResult validateRollupConfig(RollupConfig config) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (config.rollupId == null || config.rollupId.trim().isEmpty()) {
            errors.add("rollupId must be a non-empty string");
        }

        if (config.settlement == null) {
            errors.add("settlement \"" + wire(config.settlement) + "\" is not a valid settlement paradigm");
        }
        if (config.sequencer == null) {
            errors.add("sequencer \"" + wire(config.sequencer) + "\" is not a valid sequencer mode");
        }
        if (config.proofSystem == null) {
            errors.add("proofSystem \"" + wire(config.proofSystem) + "\" is not a valid proof system");
        }
        if (config.da == null) {
            errors.add("da \"" + wire(config.da) + "\" is not a valid data-availability backend");
        }
        if (config.gasModel == null) {
            errors.add("gasModel \"null\" is not a valid gas model");
        }
        if (config.vmType == null) {
            errors.add("vmType \"null\" is not a valid VM type");
        }

        // Compatibility matrix (only meaningful once both values are valid).
        if (config.settlement != null
                && config.proofSystem != null
                && !Matrix.isProofCompatible(config.settlement, config.proofSystem)) {
            String expected =
                    Matrix.validProofSystems(config.settlement).stream()
                            .map(ProofSystem::wire)
                            .collect(Collectors.joining(", "));
            errors.add(
                    "proof system \""
                            + config.proofSystem.wire()
                            + "\" is not compatible with \""
                            + config.settlement.wire()
                            + "\" settlement (expected one of: "
                            + expected
                            + ")");
        }

        // Based settlement requires the based sequencer mode.
        if (config.settlement != null
                && Matrix.requiresBasedSequencer(config.settlement)
                && config.sequencer != SequencerMode.BASED) {
            errors.add("based settlement requires the \"based\" sequencer mode");
        }

        if (config.blockTimeMs <= 0) {
            errors.add("blockTimeMs must be a positive integer");
        }
        if (config.maxTxPerBlock <= 0) {
            errors.add("maxTxPerBlock must be a positive integer");
        }

        if (config.stakeAmountUqor != null && !isPositiveIntegerString(config.stakeAmountUqor)) {
            errors.add("stakeAmountUqor must be a positive integer string (base uqor)");
        }
        if (config.challengeWindowSecs != null && config.challengeWindowSecs <= 0) {
            errors.add("challengeWindowSecs must be a positive integer");
        }
        if (config.maxDaBlobSize != null && config.maxDaBlobSize <= 0) {
            errors.add("maxDaBlobSize must be a positive integer (bytes)");
        }

        // Celestia is a selectable but not-yet-active backend on the network.
        if (config.da == DABackend.CELESTIA || config.da == DABackend.BOTH) {
            warnings.add(
                    "Celestia data availability is selectable but not yet active on the network; "
                            + "batches targeting it will not be served until it is enabled.");
        }

        return new ValidationResult(errors.isEmpty(), errors, warnings);
    }

    /** Validate a configuration and throw {@link RollupConfigError} on any error. */
    public static void assertValidRollupConfig(RollupConfig config) {
        ValidationResult result = validateRollupConfig(config);
        if (!result.valid) {
            throw new RollupConfigError(result.errors);
        }
    }

    private static String wire(SettlementParadigm v) {
        return v == null ? "null" : v.wire();
    }

    private static String wire(SequencerMode v) {
        return v == null ? "null" : v.wire();
    }

    private static String wire(ProofSystem v) {
        return v == null ? "null" : v.wire();
    }

    private static String wire(DABackend v) {
        return v == null ? "null" : v.wire();
    }
}
