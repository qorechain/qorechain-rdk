package rdk

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// FaucetOptions configures a faucet request.
type FaucetOptions struct {
	// URL is the faucet endpoint URL. Required.
	URL string
	// Address is the address to fund.
	Address string
	// Denom is the denomination to request. Empty defaults to uqor.
	Denom string
	// HTTP doer (for testing). Nil uses http.DefaultClient.
	HTTP HTTPDoer
}

// FaucetResult is the outcome of a faucet request.
type FaucetResult struct {
	OK     bool
	Status int
	Body   any
}

// RequestFaucet requests testnet funds from a configured faucet URL. The network
// does not publish a fixed faucet endpoint, so a URL must be supplied. It errors
// clearly when no URL is configured rather than guessing one.
func RequestFaucet(ctx context.Context, options FaucetOptions) (FaucetResult, error) {
	if options.URL == "" {
		return FaucetResult{}, errors.New(
			"No faucet URL configured. Set a faucet endpoint (e.g. QORE_FAUCET_URL) or fund the " +
				"account manually — see the keys & funding guide.")
	}
	denom := options.Denom
	if denom == "" {
		denom = "uqor"
	}
	doer := options.HTTP
	if doer == nil {
		doer = http.DefaultClient
	}
	payload, err := json.Marshal(map[string]any{"address": options.Address, "denom": denom})
	if err != nil {
		return FaucetResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, options.URL, bytes.NewReader(payload))
	if err != nil {
		return FaucetResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := doer.Do(req)
	if err != nil {
		return FaucetResult{}, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var body any
	_ = json.Unmarshal(raw, &body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return FaucetResult{}, fmt.Errorf("Faucet request failed: %d %s", res.StatusCode, http.StatusText(res.StatusCode))
	}
	return FaucetResult{OK: true, Status: res.StatusCode, Body: body}, nil
}
