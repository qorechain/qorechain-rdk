package rdk

import "testing"

func TestRollupActionGuards(t *testing.T) {
	if !CanPerformRollupAction(ActionPause, RollupActive) {
		t.Error("pause should be allowed from active")
	}
	if CanPerformRollupAction(ActionPause, RollupPaused) {
		t.Error("pause should not be allowed from paused")
	}
	if !CanPerformRollupAction(ActionResume, RollupPaused) {
		t.Error("resume should be allowed from paused")
	}
	if !CanPerformRollupAction(ActionStop, RollupActive) || !CanPerformRollupAction(ActionStop, RollupPaused) {
		t.Error("stop should be allowed from active and paused")
	}
	if err := AssertRollupAction(ActionPause, RollupStopped); err == nil {
		t.Error("expected error pausing a stopped rollup")
	}
	if err := AssertRollupAction(ActionPause, RollupActive); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestBatchTransitions(t *testing.T) {
	if IsBatchFinal(BatchSubmitted) {
		t.Error("submitted is not final")
	}
	if !IsBatchFinal(BatchFinalized) || !IsBatchFinal(BatchRejected) {
		t.Error("finalized/rejected are terminal")
	}
}

func TestChallengeWindow(t *testing.T) {
	if ChallengeWindowDeadline(1000, 604800) != 605800 {
		t.Error("deadline math wrong")
	}
	if !IsChallengeWindowClosed(1000, 100, 1100) {
		t.Error("window should be closed at deadline")
	}
	if IsChallengeWindowClosed(1000, 100, 1099) {
		t.Error("window should be open before deadline")
	}
}

func TestTxClientLifecycleGuards(t *testing.T) {
	acc := Account{Address: "qor1creator"}
	c := NewRdkTxClient(acc, "qorechain-diana", nil)

	if _, err := c.PauseRollup("r1", "x", RollupStopped); err == nil {
		t.Error("pause from stopped should error")
	}
	msg, err := c.PauseRollup("r1", "x", RollupActive)
	if err != nil {
		t.Fatal(err)
	}
	if msg.Creator != "qor1creator" || msg.RollupID != "r1" || msg.Reason != "x" {
		t.Errorf("unexpected pause msg: %+v", msg)
	}

	if _, err := c.ResumeRollup("r1", RollupActive); err == nil {
		t.Error("resume from active should error")
	}
	if _, err := c.StopRollup("r1", RollupActive); err != nil {
		t.Errorf("stop from active should be allowed: %v", err)
	}

	// Signer fields are filled from the client address.
	cr := c.CreateRollup(CreateRollupInput{RollupID: "r1", Profile: "defi", VmType: "evm", StakeAmount: 1})
	if cr.Creator != "qor1creator" {
		t.Errorf("create rollup creator not set: %+v", cr)
	}
	sb := c.SubmitBatch(SubmitBatchInput{RollupID: "r1", BatchIndex: 1})
	if sb.Sequencer != "qor1creator" {
		t.Errorf("submit batch sequencer not set: %+v", sb)
	}
}
