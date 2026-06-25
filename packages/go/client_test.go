package rdk

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRestClientReads(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/params":
			_, _ = w.Write([]byte(`{"params":{"max_rollups":100,"min_stake_for_rollup":"10000000000","rollup_creation_burn_rate":"0.01","default_challenge_window":604800,"max_da_blob_size":2097152,"blob_retention_blocks":432000,"max_batches_per_block":10}}`))
		case "/qorechain/rdk/v1/rollup/my-rollup":
			_, _ = w.Write([]byte(`{"rollup":{"rollup_id":"my-rollup","creator":"qor1c","profile":"defi","settlement_mode":"zk","status":"active","stake_amount":"10000000000","block_time_ms":500}}`))
		case "/qorechain/rdk/v1/rollups":
			_, _ = w.Write([]byte(`{"rollups":[{"rollup_id":"a"},{"rollup_id":"b"}]}`))
		case "/cosmos/bank/v1beta1/balances/qor1c/by_denom":
			_, _ = w.Write([]byte(`{"balance":{"denom":"uqor","amount":"500"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewRestClient(srv.URL, srv.Client())
	ctx := context.Background()

	params, err := c.GetParams(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if params.MaxRollups != 100 || params.MinStakeForRollup != "10000000000" ||
		params.RollupCreationBurnRate != "0.01" || params.DefaultChallengeWindow != 604800 {
		t.Errorf("unexpected params: %+v", params)
	}

	rollup, err := c.GetRollup(ctx, "my-rollup")
	if err != nil {
		t.Fatal(err)
	}
	if rollup.RollupID != "my-rollup" || rollup.SettlementMode != "zk" || rollup.Status != "active" || rollup.BlockTimeMs != 500 {
		t.Errorf("unexpected rollup: %+v", rollup)
	}

	rollups, err := c.ListRollups(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rollups) != 2 || rollups[0].RollupID != "a" {
		t.Errorf("unexpected rollups: %+v", rollups)
	}

	bal, err := c.GetBalance(ctx, "qor1c", "")
	if err != nil {
		t.Fatal(err)
	}
	if bal != "500" {
		t.Errorf("balance got %s want 500", bal)
	}
}

func TestRestClientErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	defer srv.Close()
	c := NewRestClient(srv.URL, srv.Client())
	if _, err := c.GetParams(context.Background()); err == nil {
		t.Error("expected error on 500")
	}
}

func TestRestClientBroadcast(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cosmos/tx/v1beta1/txs" {
			buf, _ := io.ReadAll(r.Body)
			gotBody = string(buf)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"tx_response":{"code":0,"txhash":"ABC123"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	c := NewRestClient(srv.URL, srv.Client())
	resp, err := c.BroadcastTxBytes(context.Background(), []byte{0x0a, 0x01, 0x02})
	if err != nil {
		t.Fatal(err)
	}
	if gotBody == "" {
		t.Error("broadcast did not POST a body")
	}
	txResp := asRecord(resp["tx_response"])
	if asStr(txResp["txhash"], "") != "ABC123" {
		t.Errorf("unexpected broadcast response: %+v", resp)
	}
}

func TestQorClientJSONRPC(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Echo a result based on method by reading the body.
		buf, _ := io.ReadAll(r.Body)
		body := string(buf)
		if strings.Contains(body, "qor_getRollupStatus") {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"rollupId":"r1","status":"active"}}`))
			return
		}
		if strings.Contains(body, "qor_suggestRollupProfile") {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"profile":"gaming"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}`))
	}))
	defer srv.Close()

	c := NewQorClient(srv.URL, srv.Client())
	ctx := context.Background()

	status, err := c.GetRollupStatus(ctx, "r1")
	if err != nil {
		t.Fatal(err)
	}
	if asStr(status["status"], "") != "active" {
		t.Errorf("unexpected status: %+v", status)
	}

	// Error path.
	if _, err := c.GetDABlobStatus(ctx, "r1", 0); err == nil {
		t.Error("expected JSON-RPC error")
	}
}

func TestRdkClientSuggestProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"profile":"gaming"}}`))
	}))
	defer srv.Close()

	client := NewRdkClient(RdkClientOptions{
		Endpoints: &Endpoints{EvmRPC: srv.URL, Rest: srv.URL},
		HTTP:      srv.Client(),
	})
	sugg := client.SuggestProfile(context.Background(), "high-frequency game", "")
	if sugg.Profile != ProfileGaming || sugg.Source != "advisory" {
		t.Errorf("unexpected suggestion: %+v", sugg)
	}
}

func TestRdkClientSuggestProfileFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{EvmRPC: srv.URL}, HTTP: srv.Client()})
	sugg := client.SuggestProfile(context.Background(), "anything", "")
	if sugg.Profile != ProfileDefi || sugg.Source != "fallback" {
		t.Errorf("expected defi fallback, got %+v", sugg)
	}
}
