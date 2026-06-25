package rdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// preflightServer serves params and a by-denom balance from inline JSON.
func preflightServer(t *testing.T, balanceJSON string, paramsOK bool) *RdkClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/qorechain/rdk/v1/params":
			if !paramsOK {
				http.Error(w, "down", http.StatusServiceUnavailable)
				return
			}
			_, _ = w.Write([]byte(`{"params":{"min_stake_for_rollup":"10000000000","rollup_creation_burn_rate":"0.01","default_challenge_window":604800}}`))
		case "/cosmos/bank/v1beta1/balances/qor1signer/by_denom":
			_, _ = w.Write([]byte(balanceJSON))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
}

func findCheck(checks []PreflightCheck, id string) (PreflightCheck, bool) {
	for _, c := range checks {
		if c.ID == id {
			return c, true
		}
	}
	return PreflightCheck{}, false
}

func TestCheckPreflightAllGreen(t *testing.T) {
	// Balance covers stake (1e10) + buffer (1e6).
	client := preflightServer(t, `{"balance":{"denom":"uqor","amount":"20000000000"}}`, true)

	cfg, err := PresetDefi().SetRollupID("r1").SetStakeAmountUqor("10000000000").Build()
	if err != nil {
		t.Fatal(err)
	}
	res := CheckPreflight(context.Background(), client, PreflightOptions{
		Config:        &cfg,
		SignerAddress: "qor1signer",
	})
	if !res.OK {
		t.Fatalf("expected preflight OK, got %+v", res)
	}
	if c, ok := findCheck(res.Checks, "rest"); !ok || c.Status != CheckOK {
		t.Errorf("rest check not OK: %+v", c)
	}
	if c, ok := findCheck(res.Checks, "config"); !ok || c.Status != CheckOK {
		t.Errorf("config check not OK: %+v", c)
	}
	if c, ok := findCheck(res.Checks, "balance"); !ok || c.Status != CheckOK {
		t.Errorf("balance check not OK: %+v", c)
	}
}

func TestCheckPreflightInsufficientBalanceFails(t *testing.T) {
	client := preflightServer(t, `{"balance":{"denom":"uqor","amount":"5"}}`, true)
	res := CheckPreflight(context.Background(), client, PreflightOptions{SignerAddress: "qor1signer"})
	if res.OK {
		t.Errorf("expected preflight to fail on low balance: %+v", res)
	}
	c, ok := findCheck(res.Checks, "balance")
	if !ok || c.Status != CheckFail {
		t.Errorf("expected a failing balance check: %+v", c)
	}
}

func TestCheckPreflightRestUnreachableFails(t *testing.T) {
	client := preflightServer(t, `{}`, false)
	res := CheckPreflight(context.Background(), client, PreflightOptions{})
	if res.OK {
		t.Errorf("expected preflight to fail when REST is unreachable: %+v", res)
	}
	c, ok := findCheck(res.Checks, "rest")
	if !ok || c.Status != CheckFail {
		t.Errorf("expected a failing rest check: %+v", c)
	}
}

func TestCheckPreflightNoSignerWarns(t *testing.T) {
	client := preflightServer(t, `{}`, true)
	res := CheckPreflight(context.Background(), client, PreflightOptions{})
	// No signer is a warning, not a failure.
	if !res.OK {
		t.Errorf("missing signer should warn, not fail: %+v", res)
	}
	c, ok := findCheck(res.Checks, "signer")
	if !ok || c.Status != CheckWarn {
		t.Errorf("expected a signer warning: %+v", c)
	}
}

func TestCheckPreflightNetworkMismatchWarns(t *testing.T) {
	client := preflightServer(t, `{}`, true)
	res := CheckPreflight(context.Background(), client, PreflightOptions{ExpectedNetwork: "mainnet"})
	c, ok := findCheck(res.Checks, "network")
	if !ok || c.Status != CheckWarn {
		t.Errorf("expected a network mismatch warning: %+v", c)
	}
	// A mere mismatch warning keeps preflight OK.
	if !res.OK {
		t.Errorf("network mismatch should not fail preflight: %+v", res)
	}
}
