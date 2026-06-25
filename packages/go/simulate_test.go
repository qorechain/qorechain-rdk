package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRestClientSimulate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cosmos/tx/v1beta1/simulate" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"gas_info":{"gas_wanted":"0","gas_used":"83210"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := NewRestClient(srv.URL, srv.Client())
	gas, err := c.SimulateTxBytes(context.Background(), []byte{0x0a, 0x01, 0x02})
	if err != nil {
		t.Fatal(err)
	}
	if gas != 83210 {
		t.Errorf("simulate gas = %d, want 83210", gas)
	}
}

func TestTxClientSimulateViaRest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cosmos/tx/v1beta1/simulate" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"gas_info":{"gas_used":"99999"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	g := loadGolden(t)
	acc, err := DeriveNativeAccount(g.Mnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	client := NewRdkTxClient(acc, "qorechain-diana", NewRestClient(srv.URL, srv.Client()))
	gas, err := client.Simulate(context.Background(),
		[]Msg{client.CreateRollup(CreateRollupInput{RollupID: "r1", Profile: "defi", VmType: "evm", StakeAmount: 1})},
		TxParams{Fee: Fee{GasLimit: 200000}})
	if err != nil {
		t.Fatal(err)
	}
	if gas != 99999 {
		t.Errorf("simulate gas = %d, want 99999", gas)
	}
}

func TestTxClientSimulateNoBackendNoRest(t *testing.T) {
	client := NewRdkTxClient(Account{Address: "qor1x"}, "chain", nil)
	if _, err := client.Simulate(context.Background(), nil, TxParams{}); err == nil {
		t.Error("expected an error simulating with no backend and no REST client")
	}
}
