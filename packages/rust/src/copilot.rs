//! QCAI Rollup Copilot — a read-only advisor that aggregates the network's
//! QCAI/RL advisory surfaces into a single, actionable view for one rollup.
//!
//! Everything here is advisory and best-effort: each underlying read is wrapped
//! so an unavailable advisory service degrades to a warning rather than failing
//! the whole call. Always review suggestions before acting on them.

use serde_json::Value;

use crate::client::facade::RdkClient;

/// The severity of a [`CopilotSuggestion`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionLevel {
    /// Informational.
    Info,
    /// A warning the operator should weigh.
    Warn,
    /// An action the operator should consider taking.
    Action,
}

impl SuggestionLevel {
    /// The wire value (`info` | `warn` | `action`).
    pub fn as_str(self) -> &'static str {
        match self {
            SuggestionLevel::Info => "info",
            SuggestionLevel::Warn => "warn",
            SuggestionLevel::Action => "action",
        }
    }
}

/// A single plain-language suggestion with a severity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopilotSuggestion {
    /// The suggestion severity.
    pub level: SuggestionLevel,
    /// The plain-language message.
    pub message: String,
}

/// Aggregated advice for a rollup.
#[derive(Debug, Clone)]
pub struct RollupAdvice {
    /// The rollup id this advice is for.
    pub rollup_id: String,
    /// The rollup's current status (`active`, `paused`, …) if it could be read.
    pub status: String,
    /// QCAI fee estimate (raw advisory payload), if available.
    pub fee_estimate: Option<Value>,
    /// QCAI network recommendations, if available.
    pub network_recommendations: Option<Value>,
    /// Open fraud investigations that reference this rollup.
    pub fraud_investigations: Vec<Value>,
    /// QCAI RL agent status, if available.
    pub rl_agent_status: Option<Value>,
    /// Plain-language, reviewable suggestions derived from the above.
    pub suggestions: Vec<CopilotSuggestion>,
    /// Advisory surfaces that could not be reached this call.
    pub warnings: Vec<String>,
}

/// Run a best-effort read: on error, push a `label: message` warning and return
/// `None` instead of bailing.
fn attempt<T, E: std::fmt::Display>(
    warnings: &mut Vec<String>,
    label: &str,
    result: Result<T, E>,
) -> Option<T> {
    match result {
        Ok(v) => Some(v),
        Err(e) => {
            warnings.push(format!("{label}: {e}"));
            None
        }
    }
}

/// Whether a record's JSON, lower-cased, contains `needle` (case-insensitive).
fn mentions(record: &Value, needle: &str) -> bool {
    serde_json::to_string(record)
        .map(|s| s.to_lowercase().contains(&needle.to_lowercase()))
        .unwrap_or(false)
}

/// Gather advice for a rollup from the QCAI fee/network/fraud surfaces and the
/// RL agent. Best-effort: unreachable surfaces are reported in `warnings` and
/// omitted, never returned as an error.
pub fn get_rollup_advice(client: &RdkClient, rollup_id: &str) -> RollupAdvice {
    let mut warnings: Vec<String> = Vec::new();
    let mut suggestions: Vec<CopilotSuggestion> = Vec::new();

    let rollup = attempt(&mut warnings, "rollup", client.rest.get_rollup(rollup_id));
    let fee_estimate = attempt(
        &mut warnings,
        "fee-estimate",
        client.rest.get_fee_estimate(None),
    );
    let net_recs = attempt(
        &mut warnings,
        "network-recommendations",
        client.rest.get_network_recommendations(),
    );
    let all_fraud = attempt(
        &mut warnings,
        "fraud-investigations",
        client.rest.get_fraud_investigations(),
    );
    let rl_status = attempt(
        &mut warnings,
        "rl-agent-status",
        client.qor.get_rl_agent_status(),
    );

    let fraud_investigations: Vec<Value> = all_fraud
        .unwrap_or_default()
        .into_iter()
        .filter(|f| mentions(f, rollup_id))
        .collect();

    let status = rollup
        .as_ref()
        .map(|r| r.status.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    // Derive reviewable, plain-language suggestions.
    if let Some(r) = rollup.as_ref() {
        if !r.status.is_empty() && r.status != "active" {
            suggestions.push(CopilotSuggestion {
                level: SuggestionLevel::Warn,
                message: format!(
                    "Rollup status is \"{}\" — operator action may be required before it settles batches.",
                    r.status
                ),
            });
        }
    }
    if !fraud_investigations.is_empty() {
        suggestions.push(CopilotSuggestion {
            level: SuggestionLevel::Action,
            message: format!(
                "{} open fraud investigation(s) reference this rollup — review batch validity before the challenge window closes.",
                fraud_investigations.len()
            ),
        });
    }
    if fee_estimate.is_some() {
        suggestions.push(CopilotSuggestion {
            level: SuggestionLevel::Info,
            message: "A live QCAI fee estimate is available — prefer it over a static gas price for batch submission.".to_string(),
        });
    }
    if net_recs.as_ref().is_some_and(|n| mentions(n, "congest")) {
        suggestions.push(CopilotSuggestion {
            level: SuggestionLevel::Warn,
            message: "QCAI reports network congestion — consider raising the fee or deferring non-urgent batches.".to_string(),
        });
    }
    if suggestions.is_empty() {
        suggestions.push(CopilotSuggestion {
            level: SuggestionLevel::Info,
            message: "No issues flagged by the QCAI advisory surfaces.".to_string(),
        });
    }

    RollupAdvice {
        rollup_id: rollup_id.to_string(),
        status,
        fee_estimate,
        network_recommendations: net_recs,
        fraud_investigations,
        rl_agent_status: rl_status,
        suggestions,
        warnings,
    }
}
