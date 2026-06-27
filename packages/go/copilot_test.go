package rdk

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetRollupAdviceAggregates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case strings.Contains(p, "/rollup/"):
			_, _ = w.Write([]byte(`{"rollup":{"rollup_id":"r","status":"active"}}`))
		case strings.Contains(p, "/ai/v1/fee-estimate"):
			_, _ = w.Write([]byte(`{"uqor":"1200"}`))
		case strings.Contains(p, "/ai/v1/network/recommendations"):
			_, _ = w.Write([]byte(`{"note":"high congestion now"}`))
		case strings.Contains(p, "/ai/v1/fraud/investigations"):
			_, _ = w.Write([]byte(`{"investigations":[{"id":"f1","rollup":"r"}]}`))
		default:
			// JSON-RPC RL agent status.
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"agent":"fee-policy","epoch":5}}`))
		}
	}))
	defer srv.Close()

	client := NewRdkClient(RdkClientOptions{
		Endpoints: &Endpoints{Rest: srv.URL, EvmRPC: srv.URL},
		HTTP:      srv.Client(),
	})
	advice := GetRollupAdvice(context.Background(), client, "r")

	if advice.RollupID != "r" {
		t.Errorf("rollupId got %q", advice.RollupID)
	}
	if len(advice.FraudInvestigations) != 1 {
		t.Errorf("fraud investigations got %d want 1", len(advice.FraudInvestigations))
	}
	hasAction := false
	hasCongestion := false
	for _, s := range advice.Suggestions {
		if s.Level == "action" {
			hasAction = true
		}
		if strings.Contains(strings.ToLower(s.Message), "congestion") {
			hasCongestion = true
		}
	}
	if !hasAction {
		t.Error("expected an action-level suggestion for fraud")
	}
	if !hasCongestion {
		t.Error("expected a congestion suggestion")
	}
	if len(advice.Warnings) != 0 {
		t.Errorf("expected no warnings, got %v", advice.Warnings)
	}
}

func TestGetRollupAdviceDegradesGracefully(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.Contains(p, "/rollup/") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"rollup":{"rollup_id":"r","status":"active"}}`))
			return
		}
		if strings.Contains(p, "/ai/v1/") {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		// RL agent JSON-RPC.
		buf, _ := io.ReadAll(r.Body)
		_ = buf
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{}}`))
	}))
	defer srv.Close()

	client := NewRdkClient(RdkClientOptions{
		Endpoints: &Endpoints{Rest: srv.URL, EvmRPC: srv.URL},
		HTTP:      srv.Client(),
	})
	advice := GetRollupAdvice(context.Background(), client, "r")
	if len(advice.Warnings) == 0 {
		t.Error("expected warnings when advisory surfaces are down")
	}
	if len(advice.Suggestions) == 0 {
		t.Error("expected at least one suggestion (never empty)")
	}
}

func TestRestAnchorAndPqcReads(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case strings.Contains(p, "/multilayer/v1/anchors/"):
			// state_root sent as hex, validator_set_hash as base64 — both tolerated.
			_, _ = w.Write([]byte(`{"anchors":[{"layer_id":"l1","layer_height":"42","state_root":"98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d","validator_set_hash":"qrvM3e7/ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3iJk=","main_chain_height":"100","anchored_at":"1700000000","transaction_count":"7"}]}`))
		case strings.Contains(p, "/multilayer/v1/anchor/"):
			_, _ = w.Write([]byte(`{"anchor":{"layer_id":"l1","layer_height":"7","state_root":"abcd"}}`))
		case strings.Contains(p, "/pqc/v1/accounts/"):
			_, _ = w.Write([]byte(`{"account":{"address":"qor1c","public_key":"deadbeef","algorithm_id":3,"algorithm_name":"ML-DSA-87"}}`))
		case strings.Contains(p, "/ai/v1/fee-estimate"):
			_, _ = w.Write([]byte(`{"uqor":"1000"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewRestClient(srv.URL, srv.Client())
	ctx := context.Background()

	anchors, err := c.GetAnchors(ctx, "l1")
	if err != nil {
		t.Fatal(err)
	}
	if len(anchors) != 1 {
		t.Fatalf("anchors got %d want 1", len(anchors))
	}
	a := anchors[0]
	if a.LayerHeight != 42 || a.MainChainHeight != 100 || a.AnchoredAt != 1700000000 || a.TransactionCount != 7 {
		t.Errorf("unexpected anchor numerics: %+v", a)
	}
	if a.StateRoot != "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d" {
		t.Errorf("hex state_root not preserved: %q", a.StateRoot)
	}
	if a.ValidatorSetHash != "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899" {
		t.Errorf("base64 validator_set_hash not decoded to hex: %q", a.ValidatorSetHash)
	}

	anchor, err := c.GetLatestAnchor(ctx, "l1")
	if err != nil {
		t.Fatal(err)
	}
	if anchor.StateRoot != "abcd" {
		t.Errorf("latest anchor state_root got %q", anchor.StateRoot)
	}

	acct, err := c.GetPqcAccount(ctx, "qor1c")
	if err != nil {
		t.Fatal(err)
	}
	if acct.PublicKey != "deadbeef" || acct.AlgorithmName != "ML-DSA-87" || acct.AlgorithmID != 3 {
		t.Errorf("unexpected pqc account: %+v", acct)
	}

	fee, err := c.GetFeeEstimate(ctx, "high")
	if err != nil {
		t.Fatal(err)
	}
	if asStr(fee["uqor"], "") != "1000" {
		t.Errorf("unexpected fee estimate: %+v", fee)
	}
}
