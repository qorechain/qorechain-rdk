package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestEventsFromTxHash(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/cosmos/tx/v1beta1/txs/ABC123" {
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","events":[
				{"type":"rollup_created","attributes":[{"key":"rollup_id","value":"r1"},{"key":"creator","value":"qor1c"}]},
				{"type":"message","attributes":[{"key":"action","value":"x"}]},
				{"type":"batch_submitted","attributes":[{"key":"batch_index","value":"0"}]}
			]}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
	events, err := EventsFromTxHash(context.Background(), client, "ABC123")
	if err != nil {
		t.Fatal(err)
	}
	// Only the rdk events are kept; "message" is filtered out.
	if len(events) != 2 {
		t.Fatalf("expected 2 rdk events, got %d: %+v", len(events), events)
	}
	if events[0].Type != "rollup_created" || events[0].Attributes["rollup_id"] != "r1" {
		t.Errorf("unexpected first event: %+v", events[0])
	}
	if events[1].Type != "batch_submitted" || events[1].Attributes["batch_index"] != "0" {
		t.Errorf("unexpected second event: %+v", events[1])
	}
}

func TestWatchRollup(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/rollup/r1":
			_, _ = w.Write([]byte(`{"rollup":{"rollup_id":"r1","status":"active"}}`))
		case "/qorechain/rdk/v1/batches/r1":
			_, _ = w.Write([]byte(`{"batch":{"batch_index":0,"status":"finalized","submitted_at":1000}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})

	var mu sync.Mutex
	updates := []RollupHealth{}
	w := WatchRollup(context.Background(), client, "r1", WatchOptions{
		Interval: 5 * time.Millisecond,
		NowSecs:  func() int64 { return 2000 },
		OnUpdate: func(h RollupHealth) {
			mu.Lock()
			updates = append(updates, h)
			mu.Unlock()
		},
		OnError: func(err error) { t.Errorf("unexpected watch error: %v", err) },
	})

	// Wait for at least two ticks (the immediate one plus an interval).
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		n := len(updates)
		mu.Unlock()
		if n >= 2 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	w.Stop()

	mu.Lock()
	defer mu.Unlock()
	if len(updates) < 2 {
		t.Fatalf("expected at least 2 health updates, got %d", len(updates))
	}
	if updates[0].RollupID != "r1" || updates[0].Status != "active" || !updates[0].Healthy {
		t.Errorf("unexpected health snapshot: %+v", updates[0])
	}
	if !updates[0].HasBatches || updates[0].LatestBatchStatus != "finalized" {
		t.Errorf("expected finalized batch in snapshot: %+v", updates[0])
	}
}

func TestWatchRollupContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/rollup/r1":
			_, _ = w.Write([]byte(`{"rollup":{"rollup_id":"r1","status":"active"}}`))
		case "/qorechain/rdk/v1/batches/r1":
			_, _ = w.Write([]byte(`{"batch":{"submitted_at":0}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
	ctx, cancel := context.WithCancel(context.Background())

	var count int
	var mu sync.Mutex
	w := WatchRollup(ctx, client, "r1", WatchOptions{
		Interval: 5 * time.Millisecond,
		OnUpdate: func(RollupHealth) {
			mu.Lock()
			count++
			mu.Unlock()
		},
	})
	time.Sleep(20 * time.Millisecond)
	cancel()
	w.Stop()

	mu.Lock()
	stopped := count
	mu.Unlock()
	if stopped == 0 {
		t.Error("expected at least one update before cancel")
	}
	// After Stop returns the goroutine has exited; no further updates can arrive.
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if count != stopped {
		t.Errorf("updates continued after Stop: %d -> %d", stopped, count)
	}
}
