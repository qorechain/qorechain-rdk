package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// healthServer serves params, a rollup, its latest batch, and a chain tip from
// inline JSON. Both REST and RPC point at it, so no test reaches a real network.
func healthServer(t *testing.T, rollupJSON, batchJSON, statusJSON string) *RdkClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/params":
			_, _ = w.Write([]byte(`{"params":{"default_challenge_window":604800,"min_stake_for_rollup":"10000000000","rollup_creation_burn_rate":"0.01"}}`))
		case "/qorechain/rdk/v1/rollup/r1":
			_, _ = w.Write([]byte(rollupJSON))
		case "/qorechain/rdk/v1/latest_batch/r1":
			_, _ = w.Write([]byte(batchJSON))
		case "/status":
			if statusJSON == "" {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write([]byte(statusJSON))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL, RPC: srv.URL}, HTTP: srv.Client()})
}

const tipAt1500 = `{"result":{"sync_info":{"latest_block_height":"1500","latest_block_time":"2023-11-14T22:13:20.123456789Z"}}}`

// SubmittedAt is a BLOCK HEIGHT. These tests used to feed it as a Unix
// timestamp and assert the arithmetic that followed — encoding the bug.
func TestGetRollupHealthBlockCountWindow(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"batch_index":3,"status":"submitted","submitted_at":1000}}`,
		tipAt1500)

	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !health.HasBatches || health.LatestBatchIndex != 3 || health.LatestBatchHeight != 1000 {
		t.Fatalf("unexpected batch fields: %+v", health)
	}
	if !health.HasTip || health.BatchAgeBlocks != 500 {
		t.Errorf("batch age = %d blocks (tip %v), want 500", health.BatchAgeBlocks, health.HasTip)
	}
	if health.HasBatchAgeSecs {
		t.Error("no submission time was recorded, so the age in seconds must be unknown")
	}
	w := health.ChallengeWindow
	if !health.HasChallengeWindow || w.Mode != "blocks" {
		t.Fatalf("expected a block-count window: %+v", health)
	}
	if w.WindowBlocks != 604800/6 || w.DeadlineHeight != 1000+100800 || w.BlocksRemaining != 1000+100800-1500 {
		t.Errorf("unexpected window: %+v", w)
	}
	if !w.Open || w.Finalizable {
		t.Errorf("window should be open and not finalizable: %+v", w)
	}
}

func TestGetRollupHealthTimeWindow(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"batch_index":4,"status":"submitted","submitted_at":2000,"submitted_time":1700000000}}`,
		"")
	health, err := GetRollupHealth(context.Background(), client, "r1",
		HealthOptions{Tip: &ChainTip{Height: 2100, TimeSecs: 1700000100}})
	if err != nil {
		t.Fatal(err)
	}
	if !health.HasBatchAgeSecs || health.BatchAgeSecs != 100 {
		t.Errorf("batch age = %d s, want 100", health.BatchAgeSecs)
	}
	if health.ChallengeWindow.Mode != "time" || health.ChallengeDeadlineSecs != 1700000000+604800 {
		t.Errorf("unexpected time window: %+v", health)
	}
	if health.SecondsUntilChallengeDeadline != 604800-100 {
		t.Errorf("seconds until deadline = %d", health.SecondsUntilChallengeDeadline)
	}
}

func TestGetRollupHealthUsesTheRollupsOwnWindow(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active","challenge_window_sec":3600}}`,
		`{"batch":{"batch_index":1,"status":"submitted","submitted_at":1000}}`,
		"")
	health, err := GetRollupHealth(context.Background(), client, "r1",
		HealthOptions{Tip: &ChainTip{Height: 1000}})
	if err != nil {
		t.Fatal(err)
	}
	if health.ChallengeWindow.WindowBlocks != 600 {
		t.Errorf("window blocks = %d, want 600 from the rollup's own 3600 s", health.ChallengeWindow.WindowBlocks)
	}
	for _, n := range health.Notes {
		if strings.Contains(n, "global default") {
			t.Errorf("did not fall back, yet noted it did: %q", n)
		}
	}
}

func TestBatchChallengeWindowBoundary(t *testing.T) {
	// At exactly windowBlocks the chain finalizes AND still accepts a challenge.
	b := BatchView{SubmittedAt: 1000}
	if w := BatchChallengeWindow(b, 600, ChainTip{Height: 1100}); !w.Finalizable || !w.Open {
		t.Errorf("at the boundary: %+v", w)
	}
	if w := BatchChallengeWindow(b, 600, ChainTip{Height: 1101}); !w.Finalizable || w.Open {
		t.Errorf("one past the boundary: %+v", w)
	}
}

func TestGetRollupHealthNoBatches(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"submitted_at":0}}`, "")
	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{Tip: &ChainTip{Height: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if health.HasBatches {
		t.Errorf("expected no batches: %+v", health)
	}
}

func TestGetRollupHealthRejectedBatchUnhealthy(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"batch_index":1,"status":"rejected","submitted_at":1500}}`, "")
	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{Tip: &ChainTip{Height: 2000}})
	if err != nil {
		t.Fatal(err)
	}
	if health.Healthy {
		t.Errorf("rejected latest batch should be unhealthy: %+v", health)
	}
}

func TestGetRollupHealthReadsTheLatestBatchRoute(t *testing.T) {
	// Before 0.6.0 this hit /batches/{id}?latest=true, got the list back, read
	// it as one empty batch, and reported "no batches yet" for every rollup.
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"batch_index":1,"status":"finalized","submitted_at":10}}`, "")
	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{Tip: &ChainTip{Height: 20}})
	if err != nil {
		t.Fatal(err)
	}
	if !health.HasBatches {
		t.Errorf("expected the latest batch to be found: %+v", health)
	}
}

func TestGetRollupHealthRollupErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL, RPC: srv.URL}, HTTP: srv.Client()})
	if _, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{Tip: &ChainTip{Height: 1}}); err == nil {
		t.Fatal("expected an error when the rollup cannot be read")
	}
}

func TestGetChainTipParsesStatus(t *testing.T) {
	client := healthServer(t, `{}`, `{}`, tipAt1500)
	tip, err := client.GetChainTip(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if tip.Height != 1500 || tip.TimeSecs != 1700000000 {
		t.Errorf("tip = %+v, want height 1500 and time 1700000000", tip)
	}
}
