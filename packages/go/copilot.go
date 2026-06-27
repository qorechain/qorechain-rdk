package rdk

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// CopilotSuggestion is a single plain-language suggestion with a severity.
type CopilotSuggestion struct {
	// Level is one of "info", "warn", or "action".
	Level   string
	Message string
}

// RollupAdvice is the aggregated, advisory view for a single rollup produced by
// the QCAI Rollup Copilot.
type RollupAdvice struct {
	RollupID string
	// Status is the rollup's current status (active, paused, …) if it could be
	// read, otherwise "unknown".
	Status string
	// FeeEstimate is the QCAI fee estimate (raw advisory payload), if available.
	FeeEstimate map[string]any
	// NetworkRecommendations is the QCAI network recommendations, if available.
	NetworkRecommendations map[string]any
	// FraudInvestigations are the open fraud investigations that reference this
	// rollup.
	FraudInvestigations []map[string]any
	// RLAgentStatus is the QCAI RL agent status, if available.
	RLAgentStatus map[string]any
	// Suggestions are plain-language, reviewable suggestions derived from the
	// above.
	Suggestions []CopilotSuggestion
	// Warnings lists advisory surfaces that could not be reached this call.
	Warnings []string
}

// mentions reports whether the lower-cased JSON of a record contains needle, for
// substring matching across unknown shapes.
func mentions(record any, needle string) bool {
	b, err := json.Marshal(record)
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(b)), strings.ToLower(needle))
}

// GetRollupAdvice gathers advice for a rollup from the QCAI fee/network/fraud
// surfaces and the RL agent. It is best-effort: unreachable surfaces are
// reported in Warnings and omitted, never returned as an error. Always review
// the suggestions before acting on them.
func GetRollupAdvice(ctx context.Context, client *RdkClient, rollupID string) RollupAdvice {
	var warnings []string
	var suggestions []CopilotSuggestion

	rollup, err := client.Rest.GetRollup(ctx, rollupID)
	rollupOK := err == nil
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("rollup: %v", err))
	}

	feeEstimate, err := client.Rest.GetFeeEstimate(ctx, "")
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("fee-estimate: %v", err))
		feeEstimate = nil
	}

	netRecs, err := client.Rest.GetNetworkRecommendations(ctx)
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("network-recommendations: %v", err))
		netRecs = nil
	}

	allFraud, err := client.Rest.GetFraudInvestigations(ctx)
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("fraud-investigations: %v", err))
		allFraud = nil
	}

	rlStatus, err := client.Qor.GetRLAgentStatus(ctx)
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("rl-agent-status: %v", err))
		rlStatus = nil
	}

	fraudInvestigations := []map[string]any{}
	for _, f := range allFraud {
		if mentions(f, rollupID) {
			fraudInvestigations = append(fraudInvestigations, f)
		}
	}

	// Derive reviewable, plain-language suggestions.
	if rollupOK && rollup.Status != "" && rollup.Status != "active" {
		suggestions = append(suggestions, CopilotSuggestion{
			Level:   "warn",
			Message: fmt.Sprintf("Rollup status is %q — operator action may be required before it settles batches.", rollup.Status),
		})
	}
	if len(fraudInvestigations) > 0 {
		suggestions = append(suggestions, CopilotSuggestion{
			Level:   "action",
			Message: fmt.Sprintf("%d open fraud investigation(s) reference this rollup — review batch validity before the challenge window closes.", len(fraudInvestigations)),
		})
	}
	if feeEstimate != nil {
		suggestions = append(suggestions, CopilotSuggestion{
			Level:   "info",
			Message: "A live QCAI fee estimate is available — prefer it over a static gas price for batch submission.",
		})
	}
	if netRecs != nil && mentions(netRecs, "congest") {
		suggestions = append(suggestions, CopilotSuggestion{
			Level:   "warn",
			Message: "QCAI reports network congestion — consider raising the fee or deferring non-urgent batches.",
		})
	}
	if len(suggestions) == 0 {
		suggestions = append(suggestions, CopilotSuggestion{
			Level:   "info",
			Message: "No issues flagged by the QCAI advisory surfaces.",
		})
	}

	status := "unknown"
	if rollupOK && rollup.Status != "" {
		status = rollup.Status
	}
	if warnings == nil {
		warnings = []string{}
	}

	return RollupAdvice{
		RollupID:               rollupID,
		Status:                 status,
		FeeEstimate:            feeEstimate,
		NetworkRecommendations: netRecs,
		FraudInvestigations:    fraudInvestigations,
		RLAgentStatus:          rlStatus,
		Suggestions:            suggestions,
		Warnings:               warnings,
	}
}
