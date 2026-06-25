package rdk

import (
	"fmt"
	"strings"
)

// RollupAction is a creator-initiated rollup lifecycle action.
type RollupAction string

const (
	// ActionPause pauses an active rollup.
	ActionPause RollupAction = "pause"
	// ActionResume resumes a paused rollup.
	ActionResume RollupAction = "resume"
	// ActionStop stops a rollup permanently.
	ActionStop RollupAction = "stop"
)

// RollupActionFrom maps each rollup action to the statuses it is permitted from.
var RollupActionFrom = map[RollupAction][]RollupStatus{
	ActionPause:  {RollupActive},
	ActionResume: {RollupPaused},
	ActionStop:   {RollupActive, RollupPaused},
}

// CanPerformRollupAction reports whether a rollup action is allowed from the
// given status.
func CanPerformRollupAction(action RollupAction, status RollupStatus) bool {
	return contains(RollupActionFrom[action], status)
}

// AssertRollupAction returns an error if a rollup action is not allowed from the
// given status.
func AssertRollupAction(action RollupAction, status RollupStatus) error {
	if CanPerformRollupAction(action, status) {
		return nil
	}
	allowed := RollupActionFrom[action]
	names := make([]string, len(allowed))
	for i, s := range allowed {
		names[i] = string(s)
	}
	from := strings.Join(names, ", ")
	if from == "" {
		from = "none"
	}
	return fmt.Errorf("cannot %s a rollup in status %q (allowed from: %s)", action, status, from)
}

// BatchTransitions are the valid next states for each batch status. A
// finalized/rejected batch is terminal.
var BatchTransitions = map[BatchStatus][]BatchStatus{
	BatchSubmitted:  {BatchFinalized, BatchChallenged},
	BatchChallenged: {BatchRejected, BatchFinalized},
	BatchFinalized:  {},
	BatchRejected:   {},
}

// IsBatchFinal reports whether a batch status is terminal (finalized or rejected).
func IsBatchFinal(status BatchStatus) bool {
	return len(BatchTransitions[status]) == 0
}

// ChallengeWindowDeadline returns the Unix timestamp (seconds) at which an
// optimistic batch's challenge window closes.
func ChallengeWindowDeadline(submittedAtSecs, windowSecs int64) int64 {
	return submittedAtSecs + windowSecs
}

// IsChallengeWindowClosed reports whether an optimistic batch's challenge window
// has elapsed at nowSecs.
func IsChallengeWindowClosed(submittedAtSecs, windowSecs, nowSecs int64) bool {
	return nowSecs >= ChallengeWindowDeadline(submittedAtSecs, windowSecs)
}
