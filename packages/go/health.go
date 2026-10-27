package rdk

import (
	"context"
	"fmt"
)

// RollupHealth is a consolidated, beginner-friendly read of a rollup's status,
// its latest settlement batch, and (for optimistic rollups) the challenge
// window, judged with the chain's own rules.
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
	// LatestBatchHeight is the height the latest batch was submitted at.
	LatestBatchHeight int
	// BatchAgeBlocks is blocks since the latest batch was submitted (valid
	// when HasTip).
	BatchAgeBlocks int64
	// BatchAgeSecs is seconds since submission — valid only when the node
	// records the submission time (chain v3.2.4+, HasBatchAgeSecs); a height
	// alone cannot be turned into a time.
	BatchAgeSecs    int64
	HasBatchAgeSecs bool
	// ChallengeWindow is the latest pending batch's window, by the chain's own
	// rules (valid when HasChallengeWindow).
	ChallengeWindow    ChallengeWindowStatus
	HasChallengeWindow bool
	// ChallengeDeadlineSecs and SecondsUntilChallengeDeadline are set in time
	// mode only; on the block-count path see ChallengeWindow.DeadlineHeight.
	ChallengeDeadlineSecs         int64
	SecondsUntilChallengeDeadline int64
	// HeldBackBy is set when the latest batch could finalize on its own window
	// but an earlier batch is still submitted or challenged: from chain v3.2.5
	// (rdk-challenge-settlement) batches finalize in order, so a batch whose
	// own window has passed still waits for every earlier batch. Nil otherwise.
	HeldBackBy *HeldBackBy
	// HasTip reports whether the chain tip could be read.
	HasTip bool
	// Healthy is a coarse health flag: active rollup, latest batch not rejected.
	Healthy bool
	// Notes are human-readable observations.
	Notes []string
}

// HeldBackBy names the earlier batch a latest batch is waiting for.
type HeldBackBy struct {
	BatchIndex int
	Status     string
}

// oldestUnsettledBefore finds the oldest batch before latestIndex that is still
// submitted or challenged, or nil. At most MaxPendingOptimisticBatches batches
// can be waiting, so the search starts that far back instead of at batch 0.
func oldestUnsettledBefore(ctx context.Context, client *RdkClient, rollupID string, latestIndex int) (*HeldBackBy, error) {
	start := latestIndex - MaxPendingOptimisticBatches
	if start < 0 {
		start = 0
	}
	batches, err := client.Rest.ListBatchesFrom(ctx, rollupID, uint64(start))
	if err != nil {
		return nil, err
	}
	var oldest *HeldBackBy
	for _, b := range batches {
		if b.BatchIndex >= latestIndex || (b.Status != "submitted" && b.Status != "challenged") {
			continue
		}
		if oldest == nil || b.BatchIndex < oldest.BatchIndex {
			oldest = &HeldBackBy{BatchIndex: b.BatchIndex, Status: b.Status}
		}
	}
	return oldest, nil
}

// HealthOptions configures GetRollupHealth.
type HealthOptions struct {
	// Tip overrides the chain tip. Nil reads the node's /status.
	Tip *ChainTip
	// NowSecs, when non-zero, overrides the tip's block time (it cannot supply
	// a height). Kept from earlier releases.
	NowSecs int64
	// ChallengeWindowSecs overrides the rollup's window. Zero uses the value
	// the node reports for this rollup (chain v3.2.4+), then the global param.
	ChallengeWindowSecs uint64
}

// GetRollupHealth assembles a RollupHealth snapshot for a rollup.
func GetRollupHealth(ctx context.Context, client *RdkClient, rollupID string, options HealthOptions) (RollupHealth, error) {
	notes := []string{}

	rollup, err := client.Rest.GetRollup(ctx, rollupID)
	if err != nil {
		return RollupHealth{}, err
	}
	healthy := rollup.Status == "active"
	if rollup.Status != "active" {
		notes = append(notes, fmt.Sprintf("rollup status is %q", rollup.Status))
	}

	health := RollupHealth{RollupID: rollupID, Status: rollup.Status, Healthy: healthy, Notes: notes}

	latest, err := client.Rest.GetLatestBatch(ctx, rollupID)
	if err != nil || latest.SubmittedAt == 0 {
		health.Notes = append(health.Notes, "no settlement batches submitted yet")
		return health, nil
	}

	health.HasBatches = true
	health.LatestBatchIndex = latest.BatchIndex
	health.LatestBatchStatus = latest.Status
	health.LatestBatchHeight = latest.SubmittedAt

	if latest.Status == "rejected" {
		healthy = false
		health.Notes = append(health.Notes, "latest batch was rejected")
	}

	var tip *ChainTip
	if options.Tip != nil {
		t := *options.Tip
		tip = &t
	} else if t, terr := client.GetChainTip(ctx); terr == nil {
		tip = &t
	} else {
		health.Notes = append(health.Notes, "could not read the chain tip: "+terr.Error())
	}
	if tip != nil && options.NowSecs != 0 && options.Tip == nil {
		tip.TimeSecs = options.NowSecs
	}
	if tip != nil {
		health.HasTip = true
		health.BatchAgeBlocks = tip.Height - int64(latest.SubmittedAt)
		if latest.SubmittedTime > 0 {
			health.BatchAgeSecs = tip.TimeSecs - latest.SubmittedTime
			health.HasBatchAgeSecs = true
		}
	}

	if latest.Status == "submitted" || latest.Status == "challenged" {
		windowSecs := options.ChallengeWindowSecs
		fellBack := false
		if windowSecs == 0 && rollup.ChallengeWindowSec != nil {
			windowSecs = *rollup.ChallengeWindowSec
		}
		if windowSecs == 0 && options.ChallengeWindowSecs == 0 && rollup.ChallengeWindowSec == nil {
			if params, perr := client.Params(ctx); perr == nil {
				windowSecs = uint64(params.DefaultChallengeWindow)
			}
			fellBack = true
		}
		if tip != nil {
			w := BatchChallengeWindow(latest, windowSecs, *tip)
			health.ChallengeWindow = w
			health.HasChallengeWindow = true
			if w.Mode == "time" {
				health.ChallengeDeadlineSecs = w.DeadlineSecs
				health.SecondsUntilChallengeDeadline = w.SecondsRemaining
			}
		}
		if fellBack {
			health.Notes = append(health.Notes,
				"this node does not report the rollup's own challenge window; using the global default, which is wrong for a rollup that set its own")
		}
		if latest.Status == "challenged" {
			health.Notes = append(health.Notes, "latest batch is under challenge")
		}
		if latest.Status == "submitted" && health.HasChallengeWindow && health.ChallengeWindow.Finalizable {
			if note := checkInOrderSettlement(ctx, client, rollupID, latest.BatchIndex, &health); note != "" {
				health.Notes = append(health.Notes, note)
			}
		}
	}

	health.Healthy = healthy
	return health, nil
}

// checkInOrderSettlement sets health.HeldBackBy when the chain settles batches
// in order and an earlier batch is still unsettled, returning the note to add.
// A read that fails is reported as a note rather than failing the snapshot.
func checkInOrderSettlement(ctx context.Context, client *RdkClient, rollupID string, latestIndex int, health *RollupHealth) string {
	on, err := client.Rest.IsProtocolFeatureEnabled(ctx, FeatureRDKChallengeSettlement)
	if err != nil {
		return "could not read the chain's protocol features: " + err.Error()
	}
	if !on {
		return ""
	}
	blocker, err := oldestUnsettledBefore(ctx, client, rollupID, latestIndex)
	if err != nil {
		return "could not read the earlier batches: " + err.Error()
	}
	if blocker == nil {
		return ""
	}
	health.HeldBackBy = blocker
	return fmt.Sprintf("batch %d's window has passed, but batches finalize in order and batch %d is still %s",
		latestIndex, blocker.BatchIndex, blocker.Status)
}
