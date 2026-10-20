package rdk

// ChainTip is the chain tip a challenge window is judged against.
type ChainTip struct {
	Height int64
	// TimeSecs is the tip's block time, Unix seconds.
	TimeSecs int64
}

// ChallengeWindowStatus is a batch's challenge window, computed with the
// chain's own rules (x/rdk challenge_window.go).
//
// The chain chooses the rule per batch. A batch submitted under the time-based
// window (chain v3.2.4, rdk-challenge-window-time) records its submission block
// time, and its window closes once block time reaches
// SubmittedTime + windowSecs (Mode "time"). Every earlier batch keeps the
// original rule, windowSecs/6 blocks counted from the submission height (Mode
// "blocks") — which assumed 6-second blocks, so a 7-day window closes after
// about 3.75 days on mainnet and 28 hours on the testnet.
//
// On the block-count path the chain refuses a challenge once
// height-SubmittedAt > windowBlocks but finalizes once it is >=, so for exactly
// one block a batch is both finalizable and still challengeable; Open and
// Finalizable report the two separately.
type ChallengeWindowStatus struct {
	Mode        string
	Open        bool
	Finalizable bool
	// Time mode.
	DeadlineSecs     int64
	SecondsRemaining int64
	// Block-count mode.
	WindowBlocks    int64
	DeadlineHeight  int64
	BlocksRemaining int64
}

// BatchChallengeWindow computes a batch's challenge window exactly as the chain
// does. windowSecs is the rollup's own window; the global
// default_challenge_window param is only a fallback.
func BatchChallengeWindow(batch BatchView, windowSecs uint64, tip ChainTip) ChallengeWindowStatus {
	if batch.SubmittedTime > 0 {
		elapsed := tip.TimeSecs - batch.SubmittedTime
		// The chain treats a negative elapsed (tip before submission) as not elapsed.
		elapsedFully := elapsed >= 0 && uint64(elapsed) >= windowSecs
		deadline := batch.SubmittedTime + int64(windowSecs)
		return ChallengeWindowStatus{
			Mode:             "time",
			Open:             !elapsedFully,
			Finalizable:      elapsedFully,
			DeadlineSecs:     deadline,
			SecondsRemaining: deadline - tip.TimeSecs,
		}
	}
	windowBlocks := int64(windowSecs / 6)
	since := tip.Height - int64(batch.SubmittedAt)
	deadlineHeight := int64(batch.SubmittedAt) + windowBlocks
	return ChallengeWindowStatus{
		Mode:            "blocks",
		Open:            since <= windowBlocks,
		Finalizable:     since >= windowBlocks,
		WindowBlocks:    windowBlocks,
		DeadlineHeight:  deadlineHeight,
		BlocksRemaining: deadlineHeight - tip.Height,
	}
}
