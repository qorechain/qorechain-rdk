/**
 * QCAI Rollup Copilot — a read-only advisor that aggregates the network's
 * QCAI/RL advisory surfaces into a single, actionable view for one rollup.
 *
 * Everything here is advisory and best-effort: each underlying read is wrapped
 * so an unavailable advisory service degrades to a warning rather than failing
 * the whole call. Always review suggestions before acting on them.
 */
import type { RdkClient } from "../client/rdk-client";
import type { RawRecord } from "../client/views";

/** A single plain-language suggestion with a severity. */
export interface CopilotSuggestion {
  level: "info" | "warn" | "action";
  message: string;
}

/** Aggregated advice for a rollup. */
export interface RollupAdvice {
  rollupId: string;
  /** The rollup's current status (`active`, `paused`, …) if it could be read. */
  status: string;
  /** QCAI fee estimate (raw advisory payload), if available. */
  feeEstimate?: RawRecord;
  /** QCAI network recommendations, if available. */
  networkRecommendations?: RawRecord;
  /** Open fraud investigations that reference this rollup. */
  fraudInvestigations: RawRecord[];
  /** QCAI RL agent status, if available. */
  rlAgentStatus?: RawRecord;
  /** Plain-language, reviewable suggestions derived from the above. */
  suggestions: CopilotSuggestion[];
  /** Advisory surfaces that could not be reached this call. */
  warnings: string[];
}

async function attempt<T>(
  warnings: string[],
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`${label}: ${(err as Error).message}`);
    return undefined;
  }
}

/** Lower-cased JSON of a record, for substring matching across unknown shapes. */
function mentions(record: RawRecord, needle: string): boolean {
  try {
    return JSON.stringify(record).toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Gather advice for a rollup from the QCAI fee/network/fraud surfaces and the
 * RL agent. Best-effort: unreachable surfaces are reported in `warnings` and
 * omitted, never thrown.
 */
export async function getRollupAdvice(
  client: RdkClient,
  rollupId: string,
): Promise<RollupAdvice> {
  const warnings: string[] = [];
  const suggestions: CopilotSuggestion[] = [];

  const rollup = await attempt(warnings, "rollup", () => client.rest.getRollup(rollupId));
  const urgency = await attempt(warnings, "fee-estimate", () => client.rest.getFeeEstimate());
  const netRecs = await attempt(warnings, "network-recommendations", () =>
    client.rest.getNetworkRecommendations(),
  );
  const allFraud = await attempt(warnings, "fraud-investigations", () =>
    client.rest.getFraudInvestigations(),
  );
  const rlStatus = await attempt(warnings, "rl-agent-status", () => client.qor.getRLAgentStatus());

  const fraudInvestigations = (allFraud ?? []).filter((f) => mentions(f, rollupId));

  // Derive reviewable, plain-language suggestions.
  if (rollup?.status && rollup.status !== "active") {
    suggestions.push({
      level: "warn",
      message: `Rollup status is "${rollup.status}" — operator action may be required before it settles batches.`,
    });
  }
  if (fraudInvestigations.length > 0) {
    suggestions.push({
      level: "action",
      message: `${fraudInvestigations.length} open fraud investigation(s) reference this rollup — review batch validity before the challenge window closes.`,
    });
  }
  if (urgency) {
    suggestions.push({
      level: "info",
      message: "A live QCAI fee estimate is available — prefer it over a static gas price for batch submission.",
    });
  }
  if (netRecs && mentions(netRecs, "congest")) {
    suggestions.push({
      level: "warn",
      message: "QCAI reports network congestion — consider raising the fee or deferring non-urgent batches.",
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({ level: "info", message: "No issues flagged by the QCAI advisory surfaces." });
  }

  return {
    rollupId,
    status: rollup?.status ?? "unknown",
    feeEstimate: urgency,
    networkRecommendations: netRecs,
    fraudInvestigations,
    rlAgentStatus: rlStatus,
    suggestions,
    warnings,
  };
}
