package io.github.qorechain.rdk.copilot;

import io.github.qorechain.rdk.client.Json;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Views.RollupView;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * QCAI Rollup Copilot — a read-only advisor that aggregates the network's QCAI/RL advisory surfaces
 * into a single, actionable view for one rollup.
 *
 * <p>Everything here is advisory and best-effort: each underlying read is wrapped so an unavailable
 * advisory service degrades to a warning rather than failing the whole call. Always review
 * suggestions before acting on them.
 */
public final class Copilot {
    private Copilot() {}

    /** The severity of a {@link CopilotSuggestion}. */
    public enum Level {
        INFO,
        WARN,
        ACTION
    }

    /** A single plain-language suggestion with a severity. */
    public static final class CopilotSuggestion {
        public final Level level;
        public final String message;

        public CopilotSuggestion(Level level, String message) {
            this.level = level;
            this.message = message;
        }
    }

    /** Aggregated advice for a rollup. */
    public static final class RollupAdvice {
        public String rollupId = "";
        /** The rollup's current status ({@code active}, {@code paused}, …) if it could be read. */
        public String status = "unknown";
        /** QCAI fee estimate (raw advisory payload), if available. */
        public Map<String, Object> feeEstimate;
        /** QCAI network recommendations, if available. */
        public Map<String, Object> networkRecommendations;
        /** Open fraud investigations that reference this rollup. */
        public List<Map<String, Object>> fraudInvestigations = new ArrayList<>();
        /** QCAI RL agent status, if available. */
        public Map<String, Object> rlAgentStatus;
        /** Plain-language, reviewable suggestions derived from the above. */
        public List<CopilotSuggestion> suggestions = new ArrayList<>();
        /** Advisory surfaces that could not be reached this call. */
        public List<String> warnings = new ArrayList<>();
    }

    private static <T> T attempt(List<String> warnings, String label, Supplier<T> fn) {
        try {
            return fn.get();
        } catch (RuntimeException err) {
            warnings.add(label + ": " + err.getMessage());
            return null;
        }
    }

    /** Lower-cased JSON of a record, for substring matching across unknown shapes. */
    private static boolean mentions(Object record, String needle) {
        try {
            return Json.stringify(record).toLowerCase().contains(needle.toLowerCase());
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Gather advice for a rollup from the QCAI fee/network/fraud surfaces and the RL agent.
     * Best-effort: unreachable surfaces are reported in {@code warnings} and omitted, never thrown.
     */
    public static RollupAdvice getRollupAdvice(RdkClient client, String rollupId) {
        RollupAdvice advice = new RollupAdvice();
        advice.rollupId = rollupId;
        List<String> warnings = advice.warnings;
        List<CopilotSuggestion> suggestions = advice.suggestions;

        RollupView rollup = attempt(warnings, "rollup", () -> client.rest.getRollup(rollupId));
        Map<String, Object> urgency =
                attempt(warnings, "fee-estimate", () -> client.rest.getFeeEstimate(null));
        Map<String, Object> netRecs =
                attempt(
                        warnings,
                        "network-recommendations",
                        () -> client.rest.getNetworkRecommendations());
        List<Map<String, Object>> allFraud =
                attempt(
                        warnings,
                        "fraud-investigations",
                        () -> client.rest.getFraudInvestigations());
        Map<String, Object> rlStatus =
                attempt(warnings, "rl-agent-status", () -> client.qor.getRLAgentStatus());

        List<Map<String, Object>> fraudInvestigations = new ArrayList<>();
        if (allFraud != null) {
            for (Map<String, Object> f : allFraud) {
                if (mentions(f, rollupId)) {
                    fraudInvestigations.add(f);
                }
            }
        }
        advice.fraudInvestigations = fraudInvestigations;

        advice.status = (rollup != null && rollup.status != null && !rollup.status.isEmpty())
                ? rollup.status
                : "unknown";
        advice.feeEstimate = urgency;
        advice.networkRecommendations = netRecs;
        advice.rlAgentStatus = rlStatus;

        // Derive reviewable, plain-language suggestions.
        if (rollup != null && rollup.status != null && !rollup.status.isEmpty()
                && !"active".equals(rollup.status)) {
            suggestions.add(
                    new CopilotSuggestion(
                            Level.WARN,
                            "Rollup status is \""
                                    + rollup.status
                                    + "\" — operator action may be required before it settles batches."));
        }
        if (!fraudInvestigations.isEmpty()) {
            suggestions.add(
                    new CopilotSuggestion(
                            Level.ACTION,
                            fraudInvestigations.size()
                                    + " open fraud investigation(s) reference this rollup — review batch validity before the challenge window closes."));
        }
        if (urgency != null) {
            suggestions.add(
                    new CopilotSuggestion(
                            Level.INFO,
                            "A live QCAI fee estimate is available — prefer it over a static gas price for batch submission."));
        }
        if (netRecs != null && mentions(netRecs, "congest")) {
            suggestions.add(
                    new CopilotSuggestion(
                            Level.WARN,
                            "QCAI reports network congestion — consider raising the fee or deferring non-urgent batches."));
        }
        if (suggestions.isEmpty()) {
            suggestions.add(
                    new CopilotSuggestion(
                            Level.INFO, "No issues flagged by the QCAI advisory surfaces."));
        }

        return advice;
    }
}
