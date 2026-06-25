package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDecodeRdkEvents(t *testing.T) {
	events := []RawEvent{
		{Type: "rollup_created", Attributes: []EventAttribute{{Key: "rollup_id", Value: "r1"}, {Key: "creator", Value: "qor1c"}}},
		{Type: "transfer", Attributes: []EventAttribute{{Key: "amount", Value: "10"}}},
		{Type: "batch_finalized", Attributes: []EventAttribute{{Key: "batch_index", Value: "3"}}},
	}
	decoded := DecodeRdkEvents(events)
	if len(decoded) != 2 {
		t.Fatalf("expected 2 rdk events, got %d", len(decoded))
	}
	if decoded[0].Type != "rollup_created" || decoded[0].Attributes["rollup_id"] != "r1" {
		t.Errorf("unexpected first event: %+v", decoded[0])
	}
	ev, ok := FindRdkEvent(events, "batch_finalized")
	if !ok || ev.Attributes["batch_index"] != "3" {
		t.Errorf("FindRdkEvent failed: %+v %v", ev, ok)
	}
	if _, ok := FindRdkEvent(events, "rollup_paused"); ok {
		t.Error("should not find an absent event")
	}
}

func TestBuildDaBlob(t *testing.T) {
	blob, err := BuildDaBlob([]byte("hello"), 0)
	if err != nil {
		t.Fatal(err)
	}
	if blob.Size != 5 {
		t.Errorf("size got %d want 5", blob.Size)
	}
	// sha256("hello")
	if blob.DataHash != "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
		t.Errorf("unexpected data hash: %s", blob.DataHash)
	}
	if _, err := BuildDaBlob([]byte("toolong"), 3); err == nil {
		t.Error("expected blob-too-large error")
	}
}

func TestDaBackendAvailability(t *testing.T) {
	if !IsDaBackendAvailable(DANative) {
		t.Error("native should be available")
	}
	if IsDaBackendAvailable(DACelestia) {
		t.Error("celestia should not be available")
	}
	if err := AssertDaBackendAvailable(DACelestia); err == nil {
		t.Error("expected error for celestia")
	}
	if err := AssertDaBackendAvailable(DANative); err != nil {
		t.Errorf("native should not error: %v", err)
	}
}

func TestRequestFaucet(t *testing.T) {
	if _, err := RequestFaucet(context.Background(), FaucetOptions{Address: "qor1c"}); err == nil {
		t.Error("expected error when no URL configured")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	res, err := RequestFaucet(context.Background(), FaucetOptions{URL: srv.URL, Address: "qor1c", HTTP: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK {
		t.Error("expected ok result")
	}
}

func TestNetworks(t *testing.T) {
	net := GetNetwork("")
	if net.Name != "testnet" || net.ChainID != TestnetChainID {
		t.Errorf("default network wrong: %+v", net)
	}
	if GetNetwork("mainnet").ChainID != MainnetChainID {
		t.Error("mainnet chain id wrong")
	}
	if len(ListNetworks()) != 2 {
		t.Error("expected 2 networks")
	}
}
