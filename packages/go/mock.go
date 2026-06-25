package rdk

import "context"

// MockCall records a single SignAndBroadcast invocation against a MockTxClient.
type MockCall struct {
	// Signer is the message signer address.
	Signer string
	// Messages are the messages submitted, in order.
	Messages []Msg
	// Fee is the transaction fee.
	Fee Fee
	// Memo is the transaction memo.
	Memo string
}

// MockTxClient is an offline tx backend — the "devnet" equivalent. Wire it into
// an RdkTxClient with WithBackend to exercise the full create/submit/lifecycle
// flow without a node: it records every call and returns a successful, fake
// transaction result.
type MockTxClient struct {
	// Calls is every SignAndBroadcast call, in order.
	Calls []MockCall
	// GasEstimate is the gas returned from Simulate and reported as used.
	GasEstimate uint64
	// TxHash is the transaction hash returned in the fake response.
	TxHash string
}

// MockTxClientOptions configures a MockTxClient.
type MockTxClientOptions struct {
	// GasEstimate is the gas returned from Simulate and reported as used. Zero
	// defaults to 120000.
	GasEstimate uint64
	// TxHash overrides the fake transaction hash. Empty defaults to MOCK_TX_HASH.
	TxHash string
}

// NewMockTxClient creates a MockTxClient.
func NewMockTxClient(options MockTxClientOptions) *MockTxClient {
	gas := options.GasEstimate
	if gas == 0 {
		gas = 120000
	}
	hash := options.TxHash
	if hash == "" {
		hash = "MOCK_TX_HASH"
	}
	return &MockTxClient{GasEstimate: gas, TxHash: hash}
}

// SignAndBroadcast records the call and returns a fake successful broadcast
// response shaped like a REST tx response.
func (m *MockTxClient) SignAndBroadcast(_ context.Context, signer string, messages []Msg, p TxParams) (map[string]any, error) {
	m.Calls = append(m.Calls, MockCall{Signer: signer, Messages: messages, Fee: p.Fee, Memo: p.Memo})
	return map[string]any{
		"tx_response": map[string]any{
			"code":       float64(0),
			"height":     "1",
			"txhash":     m.TxHash,
			"gas_used":   float64(m.GasEstimate),
			"gas_wanted": float64(m.GasEstimate),
			"raw_log":    "",
			"events":     []any{},
		},
	}, nil
}

// Simulate returns the configured gas estimate without recording a call.
func (m *MockTxClient) Simulate(_ context.Context, _ string, _ []Msg, _ TxParams) (uint64, error) {
	return m.GasEstimate, nil
}
