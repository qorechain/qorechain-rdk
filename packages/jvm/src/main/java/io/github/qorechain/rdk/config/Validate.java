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
        } else {
            // The chain enforces this at creation from v3.2.2; checking here means a refused
            // id costs nothing instead of a creation fee.
            String idError = io.github.qorechain.rdk.rules.Rules.rollupIdError(config.rollupId);
            if (idError != null) {
                errors.add("rollupId \"" + config.rollupId + "\" " + idError);
            }
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
        if (config.vmType == null || !Enums.isVmType(config.vmType.wire())) {
            errors.add(
                    "vmType \""
                            + (config.vmType == null ? "null" : config.vmType.wire())
                            + "\" is not a valid VM type");
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

        // STARK settlement is refused by the chain from v3.2.8.
        if (config.proofSystem != null && Enums.PAUSED_PROOF_SYSTEMS.contains(config.proofSystem)) {
            errors.add(
                    "proof system \""
                            + config.proofSystem.wire()
                            + "\" is paused on the network: the chain refuses STARK keys and STARK"
                            + " batches until it verifies a real rollup statement; use snark (Groth16)");
        }

        // Sequencing, execution VM and privacy (chain v3.2.8+), mirroring the chain's
        // RollupConfig.Validate and its create-time rule.
        errors.addAll(
                rollupModeErrors(
                        wire(config.settlement),
                        wire(config.proofSystem),
                        config.sequencing,
                        config.executionVm,
                        config.privacy));

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

    /**
     * The chain's v3.2.8 rules for {@code sequencing}, {@code executionVm} and {@code privacy} on a
     * new rollup. Returns every violation (empty when the combination is accepted). {@code null}
     * reads as the empty string.
     *
     * <ul>
     *   <li>A new optimistic rollup needs {@code executionVm = "qledger-v1"} and {@code sequencing =
     *       "based"}.
     *   <li>{@code sequencing = "based"} is allowed for zk with snark, based settlement, and
     *       optimistic with qledger-v1.
     *   <li>{@code executionVm = "qledger-v1"} needs optimistic settlement, based sequencing, and
     *       no privacy.
     *   <li>{@code privacy = "encapsulated"} needs zk settlement with snark.
     * </ul>
     *
     * @param settlement the settlement wire value, e.g. {@code "optimistic"}
     * @param proofSystem the proof system wire value, e.g. {@code "fraud"}
     */
    public static List<String> rollupModeErrors(
            String settlement, String proofSystem, String sequencing, String executionVm, String privacy) {
        List<String> errors = new ArrayList<>();
        String seq = sequencing == null ? "" : sequencing;
        String vm = executionVm == null ? "" : executionVm;
        String priv = privacy == null ? "" : privacy;
        if (!Enums.SEQUENCING_MODES.contains(seq)) {
            errors.add("sequencing \"" + seq + "\" is not valid (want \"based\" or empty)");
        }
        if (!Enums.EXECUTION_VMS.contains(vm)) {
            errors.add("executionVm \"" + vm + "\" is not valid (want \"qledger-v1\" or empty)");
        }
        if (!Enums.ROLLUP_PRIVACY_MODES.contains(priv)) {
            errors.add("privacy \"" + priv + "\" is not valid (want \"encapsulated\" or empty)");
        }
        boolean zkSnark = "zk".equals(settlement) && "snark".equals(proofSystem);
        if ("optimistic".equals(settlement) && vm.isEmpty()) {
            errors.add(
                    "from chain v3.2.8 a new optimistic rollup needs executionVm \"qledger-v1\" and"
                            + " sequencing \"based\" (its fraud proof re-executes the batch)");
        }
        if (Enums.SEQUENCING_BASED.equals(seq)) {
            boolean eligible =
                    zkSnark
                            || "based".equals(settlement)
                            || ("optimistic".equals(settlement)
                                    && Enums.EXECUTION_VM_QLEDGER_V1.equals(vm));
            if (!eligible) {
                errors.add(
                        "settlement "
                                + settlement
                                + " with proof system "
                                + proofSystem
                                + " cannot use based sequencing (zk with snark, based settlement, or"
                                + " optimistic with qledger-v1 only)");
            }
        }
        if (Enums.EXECUTION_VM_QLEDGER_V1.equals(vm)) {
            if (!"optimistic".equals(settlement)) {
                errors.add("executionVm qledger-v1 needs optimistic settlement, not " + settlement);
            }
            if (!Enums.SEQUENCING_BASED.equals(seq)) {
                errors.add(
                        "executionVm qledger-v1 needs sequencing \"based\": its batches consume the inbox");
            }
            if (!priv.isEmpty()) {
                errors.add(
                        "a qledger-v1 rollup cannot be private: a fraud proof re-executes plaintext");
            }
        }
        if (Enums.PRIVACY_ENCAPSULATED.equals(priv) && !zkSnark) {
            errors.add(
                    "a private rollup must be zk with a snark (Groth16) key, not "
                            + settlement
                            + "/"
                            + proofSystem);
        }
        return errors;
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
