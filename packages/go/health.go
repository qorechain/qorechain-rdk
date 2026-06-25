package rdk

import (
	"context"
	"fmt"
	"time"
)

// RollupHealth is a consolidated, beginner-friendly read of a rollup's status,
// its latest settlement batch, and (for optimistic rollups) the challenge-window
// countdown.
type RollupHealth struct {
	RollupID string
	// Status is the rollup lifecycle status (active/paused/stopped/pending).
	Status string
	// HasBatches reports whether any batch has been submitted.
	HasBatches bool
	// LatestBatchIndex is the latest batch index (valid only when HasBatches).
	LatestBatchIndex int
	// LatestBatchStatus is the latest batch status (valid only when HasBatches).
	LatestBatchStatus string
	// BatchAgeSecs is seconds since the latest batch was submitted.
	BatchAgeSecs int64
	// ChallengeDeadlineSecs is when the challenge window closes (unix seconds).
	ChallengeDeadlineSecs int64
	// SecondsUntilChallengeDeadline is seconds until the window closes (negative
	// if past).
	SecondsUntilChallengeDeadline int64
	// HasChallengeWindow reports whether the challenge-window fields are set.
	HasChallengeWindow bool
	// Healthy is a coarse health flag: active rollup, latest batch not rejected.
	Healthy bool
	// Notes are human-readable observations.
	Notes []string
}

// HealthOptions configures GetRollupHealth.
type HealthOptions struct {
	// NowSecs overrides the clock (unix seconds). Zero uses time.Now.
	NowSecs int64
}

// GetRollupHealth assembles a RollupHealth snapshot for a rollup.
func GetRollupHealth(ctx context.Context, client *RdkClient, rollupID string, options HealthOptions) (RollupHealth, error) {
	nowSecs := options.NowSecs
	if nowSecs == 0 {
		nowSecs = time.Now().Unix()
	}
	notes := []string{}

	rollup, err := client.Rest.GetRollup(ctx, rollupID)
	if err != nil {
		return RollupHealth{}, err
	}
	healthy := rollup.Status == "active"
	if rollup.Status != "active" {
		notes = append(notes, fmt.Sprintf("rollup status is %q", rollup.Status))
	}

	health := RollupHealth{RollupID: rollupID, Status: rollup.Status, HasBatches: false, Healthy: healthy, Notes: notes}

	latest, err := client.Rest.GetLatestBatch(ctx, rollupID)
	if err != nil || latest.SubmittedAt == 0 {
		health.Notes = append(health.Notes, "no settlement batches submitted yet")
		return health, nil
	}

	health.HasBatches = true
	health.LatestBatchIndex = latest.BatchIndex
	health.LatestBatchStatus = latest.Status
	health.BatchAgeSecs = nowSecs - int64(latest.SubmittedAt)

	if latest.Status == "rejected" {
		healthy = false
		health.Notes = append(health.Notes, "latest batch was rejected")
	}

	if latest.Status == "submitted" || latest.Status == "challenged" {
		params, perr := client.Params(ctx)
		if perr == nil {
			deadline := int64(latest.SubmittedAt) + int64(params.DefaultChallengeWindow)
			health.ChallengeDeadlineSecs = deadline
			health.SecondsUntilChallengeDeadline = deadline - nowSecs
			health.HasChallengeWindow = true
			if latest.Status == "challenged" {
				health.Notes = append(health.Notes, "latest batch is under challenge")
			}
		}
	}

	health.Healthy = healthy
	return health, nil
}
