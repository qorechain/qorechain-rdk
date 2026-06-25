package rdk

import "context"

// TxBackend is the sign-and-broadcast capability RdkTxClient depends on. The
// default backend signs locally and broadcasts via the REST txs endpoint; the
// MockTxClient backend records calls and returns a fake successful result so the
// full lifecycle flow runs offline.
type TxBackend interface {
	// SignAndBroadcast submits messages signed by signer and returns the raw
	// broadcast response.
	SignAndBroadcast(ctx context.Context, signer string, messages []Msg, p TxParams) (map[string]any, error)
}

// SimulateBackend is the optional gas-estimation capability. The MockTxClient
// backend satisfies it; the default REST backend simulates via the chain's
// simulate endpoint.
type SimulateBackend interface {
	// Simulate estimates gas for messages without broadcasting.
	Simulate(ctx context.Context, signer string, messages []Msg, p TxParams) (uint64, error)
}

// RdkTxClient signs and broadcasts rdk transactions (rollup lifecycle,
// settlement batches, withdrawals). It builds the Cosmos tx envelope, signs the
// SignDoc, and broadcasts TxRaw via the REST txs endpoint.
//
// Account and chain context (sequence, account number, chain id) must be
// supplied per call; read the sequence and account number from the chain's auth
// query before submitting. Broadcasting is only performed when Broadcast is
// called with a live REST client.
type RdkTxClient struct {
	// Account is the signing/operator account; its address is the message signer.
	Account Account
	// ChainID is the chain id signed into every SignDoc.
	ChainID string
	// Rest is the REST client used to broadcast. May be nil for offline use.
	Rest *RestClient
	// Backend, when set, replaces the default sign-and-broadcast path. Inject a
	// MockTxClient here to exercise the flow offline.
	Backend TxBackend
}

// NewRdkTxClient creates a tx client for an account and chain id. The REST
// client is used for broadcasting and may be nil for offline signing.
func NewRdkTxClient(account Account, chainID string, rest *RestClient) *RdkTxClient {
	return &RdkTxClient{Account: account, ChainID: chainID, Rest: rest}
}

// WithBackend returns a copy of the client wired to a custom sign-and-broadcast
// backend (e.g. a MockTxClient). The account address remains the message signer.
func (c *RdkTxClient) WithBackend(backend TxBackend) *RdkTxClient {
	copy := *c
	copy.Backend = backend
	return &copy
}

// TxParams carries the per-transaction signing context and fee.
type TxParams struct {
	// Sequence is the signer account sequence.
	Sequence uint64
	// AccountNumber is the signer account number.
	AccountNumber uint64
	// Fee is the transaction fee.
	Fee Fee
	// Memo is an optional memo.
	Memo string
}

// Sign builds and signs a transaction, returning the TxRaw bytes ready to
// broadcast.
func (c *RdkTxClient) Sign(messages []Msg, p TxParams) []byte {
	return SignTx(c.Account, messages, p.Memo, p.Fee, p.Sequence, c.ChainID, p.AccountNumber)
}

// Broadcast signs and broadcasts the messages and returns the raw response.
// When a Backend is configured it is used; otherwise the messages are signed
// locally and broadcast via the REST txs endpoint, which requires a non-nil REST
// client.
func (c *RdkTxClient) Broadcast(ctx context.Context, messages []Msg, p TxParams) (map[string]any, error) {
	if c.Backend != nil {
		return c.Backend.SignAndBroadcast(ctx, c.Account.Address, messages, p)
	}
	if c.Rest == nil {
		return nil, &RollupConfigError{Errors: []string{"no REST client configured for broadcast"}}
	}
	txBytes := c.Sign(messages, p)
	return c.Rest.BroadcastTxBytes(ctx, txBytes)
}

// Simulate estimates gas for a set of messages without broadcasting — the basis
// for a dry run. When a Backend that supports simulation is configured it is
// used; otherwise the assembled tx is simulated via the chain's simulate
// endpoint, which requires a non-nil REST client.
func (c *RdkTxClient) Simulate(ctx context.Context, messages []Msg, p TxParams) (uint64, error) {
	if c.Backend != nil {
		sim, ok := c.Backend.(SimulateBackend)
		if !ok {
			return 0, &RollupConfigError{Errors: []string{"the configured backend does not support simulation"}}
		}
		return sim.Simulate(ctx, c.Account.Address, messages, p)
	}
	if c.Rest == nil {
		return 0, &RollupConfigError{Errors: []string{"no REST client configured for simulation"}}
	}
	txBytes := c.Sign(messages, p)
	return c.Rest.SimulateTxBytes(ctx, txBytes)
}

// --- message builders that fill in the signer from the client's address ---

// CreateRollup builds a MsgCreateRollup with this client's address as creator.
func (c *RdkTxClient) CreateRollup(in CreateRollupInput) MsgCreateRollup {
	in.Creator = c.Account.Address
	return CreateRollupMsg(in)
}

// SubmitBatch builds a MsgSubmitBatch with this client's address as sequencer.
func (c *RdkTxClient) SubmitBatch(in SubmitBatchInput) MsgSubmitBatch {
	in.Sequencer = c.Account.Address
	return SubmitBatchMsg(in)
}

// ChallengeBatch builds a MsgChallengeBatch with this client's address as
// challenger.
func (c *RdkTxClient) ChallengeBatch(in ChallengeBatchInput) MsgChallengeBatch {
	in.Challenger = c.Account.Address
	return ChallengeBatchMsg(in)
}

// ResolveChallenge builds a MsgResolveChallenge with this client's address as
// resolver.
func (c *RdkTxClient) ResolveChallenge(in ResolveChallengeInput) MsgResolveChallenge {
	in.Resolver = c.Account.Address
	return ResolveChallengeMsg(in)
}

// PauseRollup builds a MsgPauseRollup, optionally guarding the transition. Pass
// a non-empty currentStatus to enforce the lifecycle guard.
func (c *RdkTxClient) PauseRollup(rollupID, reason string, currentStatus RollupStatus) (MsgPauseRollup, error) {
	if currentStatus != "" {
		if err := AssertRollupAction(ActionPause, currentStatus); err != nil {
			return MsgPauseRollup{}, err
		}
	}
	return PauseRollupMsg(PauseRollupInput{Creator: c.Account.Address, RollupID: rollupID, Reason: reason}), nil
}

// ResumeRollup builds a MsgResumeRollup, optionally guarding the transition.
func (c *RdkTxClient) ResumeRollup(rollupID string, currentStatus RollupStatus) (MsgResumeRollup, error) {
	if currentStatus != "" {
		if err := AssertRollupAction(ActionResume, currentStatus); err != nil {
			return MsgResumeRollup{}, err
		}
	}
	return ResumeRollupMsg(RollupRefInput{Creator: c.Account.Address, RollupID: rollupID}), nil
}

// StopRollup builds a MsgStopRollup, optionally guarding the transition.
func (c *RdkTxClient) StopRollup(rollupID string, currentStatus RollupStatus) (MsgStopRollup, error) {
	if currentStatus != "" {
		if err := AssertRollupAction(ActionStop, currentStatus); err != nil {
			return MsgStopRollup{}, err
		}
	}
	return StopRollupMsg(RollupRefInput{Creator: c.Account.Address, RollupID: rollupID}), nil
}

// ExecuteWithdrawal builds a MsgExecuteWithdrawal with this client's address as
// submitter.
func (c *RdkTxClient) ExecuteWithdrawal(in ExecuteWithdrawalInput) MsgExecuteWithdrawal {
	in.Submitter = c.Account.Address
	return ExecuteWithdrawalMsg(in)
}
