package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// healthServer serves params, a rollup, and its latest batch from inline JSON.
func healthServer(t *testing.T, rollupJSON, batchJSON string) *RdkClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/params":
			_, _ = w.Write([]byte(`{"params":{"default_challenge_window":604800,"min_stake_for_rollup":"10000000000","rollup_creation_burn_rate":"0.01"}}`))
		case "/qorechain/rdk/v1/rollup/r1":
			_, _ = w.Write([]byte(rollupJSON))
		case "/qorechain/rdk/v1/batches/r1":
			_, _ = w.Write([]byte(batchJSON))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
}

func TestGetRollupHealthActiveWithChallengeWindow(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"batch_index":3,"status":"submitted","submitted_at":1000}}`)

	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{NowSecs: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if !health.Healthy || health.Status != "active" {
		t.Errorf("expected healthy active rollup: %+v", health)
	}
	if !health.HasBatches || health.LatestBatchIndex != 3 || health.LatestBatchStatus != "submitted" {
		t.Errorf("unexpected batch fields: %+v", health)
	}
	if health.BatchAgeSecs != 1000 {
		t.Errorf("batch age = %d, want 1000", health.BatchAgeSecs)
	}
	if !health.HasChallengeWindow {
		t.Fatalf("expected a challenge window: %+v", health)
	}
	if health.ChallengeDeadlineSecs != 1000+604800 {
		t.Errorf("challenge deadline = %d, want %d", health.ChallengeDeadlineSecs, 1000+604800)
	}
	if health.SecondsUntilChallengeDeadline != (1000+604800)-2000 {
		t.Errorf("seconds until deadline = %d", health.SecondsUntilChallengeDeadline)
	}
}

func TestGetRollupHealthNoBatches(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"submitted_at":0}}`)

	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{NowSecs: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if health.HasBatches {
		t.Errorf("expected no batches: %+v", health)
	}
	found := false
	for _, n := range health.Notes {
		if n == "no settlement batches submitted yet" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a no-batches note: %+v", health.Notes)
	}
}

func TestGetRollupHealthRejectedBatchUnhealthy(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"active"}}`,
		`{"batch":{"batch_index":1,"status":"rejected","submitted_at":1500}}`)

	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{NowSecs: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if health.Healthy {
		t.Errorf("rejected latest batch should be unhealthy: %+v", health)
	}
	if health.HasChallengeWindow {
		t.Errorf("rejected batch should not carry a challenge window: %+v", health)
	}
}

func TestGetRollupHealthPausedRollup(t *testing.T) {
	client := healthServer(t,
		`{"rollup":{"rollup_id":"r1","status":"paused"}}`,
		`{"batch":{"batch_index":1,"status":"finalized","submitted_at":1500}}`)

	health, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{NowSecs: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if health.Healthy {
		t.Errorf("paused rollup should not be healthy: %+v", health)
	}
	if len(health.Notes) == 0 {
		t.Errorf("expected a status note for a paused rollup")
	}
}

func TestGetRollupHealthRollupError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()
	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
	if _, err := GetRollupHealth(context.Background(), client, "r1", HealthOptions{NowSecs: 1}); err == nil {
		t.Error("expected an error when the rollup read fails")
	}
}
