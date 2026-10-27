package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Every proof in the withdrawalTree vectors is accepted by the chain's own
// VerifyWithdrawalMerkle, and refused at the wrong index.

func goldenWithdrawals(t *testing.T) (golden, []Withdrawal) {
	t.Helper()
	g := loadGolden(t)
	items := make([]Withdrawal, len(g.WithdrawalTree.Withdrawals))
	for i, w := range g.WithdrawalTree.Withdrawals {
		items[i] = Withdrawal{Recipient: w.Recipient, Denom: g.WithdrawalTree.Denom, Amount: w.Amount}
	}
	return g, items
}

func TestWithdrawalsTreeMatchesTheChain(t *testing.T) {
	g, items := goldenWithdrawals(t)
	w := g.WithdrawalTree
	for version, want := range map[string]goldenWithdrawalTree{"v1": w.V1, "v2": w.V2} {
		tree, err := NewWithdrawalsTree(items, WithdrawalsTreeOptions{RollupID: w.RollupID, Version: version, ChainID: w.ChainID})
		if err != nil {
			t.Fatalf("%s: %v", version, err)
		}
		if len(tree.Leaves) != len(want.Leaves) {
			t.Fatalf("%s: %d leaves, want %d", version, len(tree.Leaves), len(want.Leaves))
		}
		for i, leaf := range tree.Leaves {
			if BytesToHex(leaf) != want.Leaves[i] {
				t.Errorf("%s leaf %d: got %s want %s", version, i, BytesToHex(leaf), want.Leaves[i])
			}
		}
		if BytesToHex(tree.Root) != want.Root {
			t.Errorf("%s root: got %s want %s", version, BytesToHex(tree.Root), want.Root)
		}
		for i := range items {
			p, err := tree.Proof(i)
			if err != nil {
				t.Fatal(err)
			}
			if p.WithdrawalIndex != i || BytesToHex(p.WithdrawalsRoot) != want.Root {
				t.Errorf("%s proof %d: index %d root %s", version, i, p.WithdrawalIndex, BytesToHex(p.WithdrawalsRoot))
			}
			checkSiblings(t, p.Proof, want.Proofs[i])
		}
	}
	if w.V1.Root == w.V2.Root {
		t.Error("v1 and v2 trees must differ, so a proof cannot cross bindings")
	}
}

func TestWithdrawalLeavesMatchTheChain(t *testing.T) {
	g := loadGolden(t)
	w := g.WithdrawalTree
	in := WithdrawalLeafInput{RollupID: w.RollupID, WithdrawalIndex: 0, Recipient: "qor1alice", Denom: "uqor", Amount: 1_500_000}
	if got := BytesToHex(WithdrawalLeafV1(in)); got != w.V1.Leaves[0] {
		t.Errorf("v1 leaf: got %s want %s", got, w.V1.Leaves[0])
	}
	v2, err := WithdrawalLeafV2(w.ChainID, in)
	if err != nil {
		t.Fatal(err)
	}
	if got := BytesToHex(v2); got != w.V2.Leaves[0] {
		t.Errorf("v2 leaf: got %s want %s", got, w.V2.Leaves[0])
	}
	if _, err := WithdrawalLeafV2("", in); err == nil || !strings.Contains(err.Error(), "chain id") {
		t.Errorf("a v2 leaf without a chain id: %v", err)
	}
}

func TestWithdrawalsTreeRefusals(t *testing.T) {
	if _, err := NewWithdrawalsTree(nil, WithdrawalsTreeOptions{RollupID: "r", Version: "v1"}); err == nil {
		t.Error("an empty tree was built")
	}
	one := []Withdrawal{{Recipient: "qor1a", Denom: "uqor", Amount: 1}}
	if _, err := NewWithdrawalsTree(one, WithdrawalsTreeOptions{RollupID: "r", Version: "v2"}); err == nil {
		t.Error("a v2 tree was built without a chain id")
	}
	if _, err := NewWithdrawalsTree(one, WithdrawalsTreeOptions{RollupID: "r", Version: "v3"}); err == nil {
		t.Error("an unknown version was accepted")
	}
	tree, err := NewWithdrawalsTree(one, WithdrawalsTreeOptions{RollupID: "r", Version: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(tree.Root) != BytesToHex(tree.Leaves[0]) {
		t.Error("a one-withdrawal tree's root is its leaf")
	}
	if _, err := tree.Proof(1); err == nil {
		t.Error("an out-of-range proof was built")
	}
}

func TestDaBlobCommitmentGolden(t *testing.T) {
	g := loadGolden(t)
	blob, err := BuildDaBlob([]byte(g.DaBlob.DataUtf8), 0)
	if err != nil {
		t.Fatal(err)
	}
	if blob.DataHash != "0x"+g.DaBlob.Commitment {
		t.Errorf("commitment: got %s want 0x%s", blob.DataHash, g.DaBlob.Commitment)
	}
}

func TestQorehashConcatenates(t *testing.T) {
	if BytesToHex(Qorehash([]byte("ab"), []byte("c"))) != BytesToHex(Qorehash([]byte("abc"))) {
		t.Error("Qorehash must hash the concatenation of its parts")
	}
	if len(Qorehash()) != 32 {
		t.Error("Qorehash must return 32 bytes")
	}
}

func TestWithdrawalsRootError(t *testing.T) {
	if WithdrawalsRootError(nil) != "" || WithdrawalsRootError([]byte{}) != "" || WithdrawalsRootError(make([]byte, 32)) != "" {
		t.Error("an empty or 32-byte root must be accepted")
	}
	if e := WithdrawalsRootError(make([]byte, 31)); !strings.Contains(e, "31") {
		t.Errorf("a 31-byte root: %q", e)
	}
}

func TestStopRollupError(t *testing.T) {
	for _, s := range []string{"submitted", "challenged"} {
		if e := StopRollupError(s); !strings.Contains(e, s) {
			t.Errorf("%s: %q", s, e)
		}
	}
	for _, s := range []string{"finalized", "rejected", ""} {
		if e := StopRollupError(s); e != "" {
			t.Errorf("%q refused: %s", s, e)
		}
	}
	if MaxPendingOptimisticBatches != 4096 {
		t.Errorf("MaxPendingOptimisticBatches = %d", MaxPendingOptimisticBatches)
	}
}

func TestBroadcastRefusesABadWithdrawalsRoot(t *testing.T) {
	acc, err := DeriveNativeAccount("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", 0)
	if err != nil {
		t.Fatal(err)
	}
	backend := &recordingBackend{}
	tx := NewRdkTxClient(acc, TestnetChainID, nil).WithBackend(backend)
	bad := MsgSubmitBatch{Sequencer: acc.Address, RollupID: "my-rollup", BatchIndex: 7, WithdrawalsRoot: make([]byte, 31)}
	_, err = tx.Broadcast(context.Background(), []Msg{bad}, TxParams{})
	if err == nil || !strings.Contains(err.Error(), "cannot submit batch 7") {
		t.Fatalf("a 31-byte withdrawals root was not refused: %v", err)
	}
	if backend.calls != 0 {
		t.Fatalf("a refused batch reached signing %d time(s)", backend.calls)
	}
	good := bad
	good.WithdrawalsRoot = make([]byte, 32)
	if _, err := tx.Broadcast(context.Background(), []Msg{good}, TxParams{}); err != nil {
		t.Fatalf("a 32-byte root was refused: %v", err)
	}
}

func TestRollupViewHasVerificationKey(t *testing.T) {
	if !MapRollupView(map[string]any{"has_verification_key": true}).HasVerificationKey {
		t.Error("has_verification_key true was not mapped")
	}
	if !MapRollupView(map[string]any{"hasVerificationKey": true}).HasVerificationKey {
		t.Error("hasVerificationKey true was not mapped")
	}
	for _, raw := range []map[string]any{{}, {"has_verification_key": false}, {"has_verification_key": "true"}} {
		if MapRollupView(raw).HasVerificationKey {
			t.Errorf("%v read as having a key", raw)
		}
	}
}

// settlementServer is a mock chain whose latest batch 2 has passed its own
// window while batch 0 is still challenged.
func settlementServer(t *testing.T, featureOn bool) *RdkClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/rollup/r1":
			_, _ = w.Write([]byte(`{"rollup":{"rollup_id":"r1","status":"active","challenge_window_sec":600}}`))
		case "/qorechain/rdk/v1/latest_batch/r1":
			_, _ = w.Write([]byte(`{"batch":{"batch_index":2,"status":"submitted","submitted_at":1000}}`))
		case "/qorechain/rdk/v1/batches/r1":
			_, _ = w.Write([]byte(`{"batches":[` +
				`{"batch_index":0,"status":"challenged","submitted_at":800},` +
				`{"batch_index":1,"status":"submitted","submitted_at":900},` +
				`{"batch_index":2,"status":"submitted","submitted_at":1000}],"next_index":0}`))
		case "/qorechain/pqc/v1/protocol_features":
			if featureOn {
				_, _ = w.Write([]byte(`{"features":[{"name":"rdk-challenge-settlement","enabled":true}]}`))
			} else {
				_, _ = w.Write([]byte(`{"features":[{"name":"rdk-challenge-settlement","enabled":false}]}`))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL, RPC: srv.URL}, HTTP: srv.Client()})
}

func TestHealthHeldBackByAnEarlierBatch(t *testing.T) {
	client := settlementServer(t, true)
	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{Tip: &ChainTip{Height: 2000}})
	if err != nil {
		t.Fatal(err)
	}
	if !health.ChallengeWindow.Finalizable {
		t.Fatalf("the latest batch's own window should have passed: %+v", health.ChallengeWindow)
	}
	if health.HeldBackBy == nil || health.HeldBackBy.BatchIndex != 0 || health.HeldBackBy.Status != "challenged" {
		t.Fatalf("held back by = %+v, want batch 0 challenged", health.HeldBackBy)
	}
	found := false
	for _, n := range health.Notes {
		if strings.Contains(n, "batches finalize in order") && strings.Contains(n, "batch 0 is still challenged") {
			found = true
		}
	}
	if !found {
		t.Errorf("no in-order note: %v", health.Notes)
	}
}

func TestHealthNotHeldBackWhenTheFeatureIsOff(t *testing.T) {
	client := settlementServer(t, false)
	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{Tip: &ChainTip{Height: 2000}})
	if err != nil {
		t.Fatal(err)
	}
	if health.HeldBackBy != nil {
		t.Errorf("held back by %+v with the feature off", health.HeldBackBy)
	}
	for _, n := range health.Notes {
		if strings.Contains(n, "finalize in order") {
			t.Errorf("in-order note with the feature off: %q", n)
		}
	}
}
