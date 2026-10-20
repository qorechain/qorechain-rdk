package rdk

import (
	"context"
	"strings"
	"testing"
)

// Ported verbatim from the chain's own tests (x/rdk/types/rollup_id_test.go and
// msgs_withdrawal_test.go at v3.2.3), so a disagreement here is a disagreement
// with the chain, not with a guess.

func TestRollupIDGrammar(t *testing.T) {
	good := []string{
		"abc", "a1b", "0rollup", "my-rollup", "my_rollup", "my.rollup", "r--",
		"victim", strings.Repeat("a", 64), "9.9.9",
	}
	bad := []string{
		"", "ab", strings.Repeat("a", 65),
		"victim/x", "Victim", "ROLL", "-abc", ".abc", "_abc",
		"has space", "tab\tid", "nul\x00id", "new\nline", "é-rollup", "rollup✓",
		"a/b", "a\\b", "a:b", "a+b", "a%2fb",
	}
	for _, id := range good {
		if e := RollupIDError(id); e != "" {
			t.Errorf("%q refused: %s", id, e)
		}
	}
	for _, id := range bad {
		if RollupIDError(id) == "" {
			t.Errorf("%q accepted", id)
		}
	}
}

func goodWithdrawal() MsgExecuteWithdrawal {
	sib := make([]byte, 32)
	return MsgExecuteWithdrawal{
		Submitter: "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h", RollupID: "roll-1", Recipient: "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h",
		Denom: RollupEscrowDenom, Amount: 1, Proof: [][]byte{sib, sib},
	}
}

func TestWithdrawalErrors(t *testing.T) {
	if errs := WithdrawalErrors(goodWithdrawal()); len(errs) != 0 {
		t.Fatalf("a good withdrawal was refused: %v", errs)
	}
	deep := make([][]byte, MaxWithdrawalProofDepth+1)
	for i := range deep {
		deep[i] = make([]byte, 32)
	}
	cases := map[string]func(m *MsgExecuteWithdrawal){
		"bad submitter":  func(m *MsgExecuteWithdrawal) { m.Submitter = "nope" },
		"empty rollup":   func(m *MsgExecuteWithdrawal) { m.RollupID = "" },
		"bad recipient":  func(m *MsgExecuteWithdrawal) { m.Recipient = "nope" },
		"other denom":    func(m *MsgExecuteWithdrawal) { m.Denom = "uatom" },
		"zero amount":    func(m *MsgExecuteWithdrawal) { m.Amount = 0 },
		"negative":       func(m *MsgExecuteWithdrawal) { m.Amount = -5 },
		"short sibling":  func(m *MsgExecuteWithdrawal) { m.Proof = [][]byte{{1, 2, 3}} },
		"too deep proof": func(m *MsgExecuteWithdrawal) { m.Proof = deep },
	}
	for name, mut := range cases {
		m := goodWithdrawal()
		mut(&m)
		if len(WithdrawalErrors(m)) == 0 {
			t.Errorf("%s: accepted", name)
		}
	}
	m := goodWithdrawal()
	m.RollupID = "Legacy/ID" // ids from before v3.2.2 are not held to the grammar
	if errs := WithdrawalErrors(m); len(errs) != 0 {
		t.Errorf("old id refused: %v", errs)
	}
}

// recordingBackend counts what reached signing.
type recordingBackend struct{ calls int }

func (b *recordingBackend) SignAndBroadcast(context.Context, string, []Msg, TxParams) (map[string]any, error) {
	b.calls++
	return map[string]any{"code": 0}, nil
}

func TestBroadcastRefusesBeforeSigning(t *testing.T) {
	acc, err := DeriveNativeAccount("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", 0)
	if err != nil {
		t.Fatal(err)
	}
	backend := &recordingBackend{}
	tx := NewRdkTxClient(acc, TestnetChainID, nil).WithBackend(backend)

	bad := []Msg{tx.CreateRollup(CreateRollupInput{RollupID: "My/Rollup", Profile: "defi", VmType: "evm", StakeAmount: 1})}
	if _, err := tx.Broadcast(context.Background(), bad, TxParams{}); err == nil {
		t.Fatal("an id the chain would refuse was broadcast")
	}
	w := goodWithdrawal()
	w.Denom = "uatom"
	if _, err := tx.Broadcast(context.Background(), []Msg{w}, TxParams{}); err == nil {
		t.Fatal("a withdrawal the chain would refuse was broadcast")
	}
	if backend.calls != 0 {
		t.Fatalf("refused messages still reached signing %d time(s)", backend.calls)
	}

	good := []Msg{tx.CreateRollup(CreateRollupInput{RollupID: "my-rollup", Profile: "defi", VmType: "evm", StakeAmount: 1})}
	if _, err := tx.Broadcast(context.Background(), good, TxParams{}); err != nil {
		t.Fatalf("a valid create was refused: %v", err)
	}
	if backend.calls != 1 {
		t.Fatalf("valid message reached signing %d time(s), want 1", backend.calls)
	}
}
