package rdk

import (
	"context"
	"time"
)

// EventsFromTxHash reads a transaction by hash and decodes the rdk events it
// emitted. It reads tx_response.events from the REST tx response and runs them
// through the event decoder.
func EventsFromTxHash(ctx context.Context, client *RdkClient, hash string) ([]DecodedRdkEvent, error) {
	body, err := client.Rest.GetTx(ctx, hash)
	if err != nil {
		return nil, err
	}
	txResponse := asRecord(pick(body, "tx_response", "txResponse"))
	rawEvents := txResponseEvents(txResponse)
	return DecodeRdkEvents(rawEvents), nil
}

// txResponseEvents maps the loosely-typed events array on a tx response into
// RawEvent values the decoder understands.
func txResponseEvents(txResponse map[string]any) []RawEvent {
	out := []RawEvent{}
	for _, ev := range asArray(pick(txResponse, "events")) {
		event := RawEvent{Type: asStr(pick(ev, "type"), "")}
		for _, attr := range asArray(pick(ev, "attributes")) {
			event.Attributes = append(event.Attributes, EventAttribute{
				Key:   asStr(pick(attr, "key"), ""),
				Value: asStr(pick(attr, "value"), ""),
			})
		}
		out = append(out, event)
	}
	return out
}

// WatchOptions configures WatchRollup.
type WatchOptions struct {
	// Interval is the poll interval. Zero defaults to 5 seconds.
	Interval time.Duration
	// OnUpdate is called with each health snapshot. Required.
	OnUpdate func(RollupHealth)
	// OnError is called on a polling error; the loop continues.
	OnError func(error)
	// NowSecs overrides the clock (unix seconds), for testing. Zero uses the
	// wall clock.
	NowSecs func() int64
}

// Watcher is a handle to a running rollup watch.
type Watcher struct {
	stop context.CancelFunc
	done chan struct{}
}

// Stop ends the watch and waits for the polling goroutine to exit.
func (w *Watcher) Stop() {
	w.stop()
	<-w.done
}

// WatchRollup polls a rollup's health on an interval, invoking OnUpdate each
// tick. It honors ctx cancellation and returns a Watcher whose Stop method also
// ends the watch. The first poll runs immediately, then on every interval.
func WatchRollup(ctx context.Context, client *RdkClient, rollupID string, options WatchOptions) *Watcher {
	interval := options.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ctx, cancel := context.WithCancel(ctx)
	w := &Watcher{stop: cancel, done: make(chan struct{})}

	tick := func() {
		healthOpts := HealthOptions{}
		if options.NowSecs != nil {
			healthOpts.NowSecs = options.NowSecs()
		}
		health, err := GetRollupHealth(ctx, client, rollupID, healthOpts)
		if err != nil {
			if options.OnError != nil {
				options.OnError(err)
			}
			return
		}
		if options.OnUpdate != nil {
			options.OnUpdate(health)
		}
	}

	go func() {
		defer close(w.done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		tick()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if ctx.Err() != nil {
					return
				}
				tick()
			}
		}
	}()

	return w
}
